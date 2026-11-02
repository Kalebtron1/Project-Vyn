//! VinculoLending — préstamos en USDC con el ahorro del usuario como colateral.
//!
//! Vive en `backend/contracts/vinculo_lending/` junto a `vinculo_sbt` y `staking_pool`.
//! El tier del SBT decide el LTV y el tope. Al pedir el préstamo, `staking_pool` bloquea
//! ahorro como garantía sin moverlo, así que sigue generando rendimiento. Si el préstamo
//! vence y pasa el periodo de gracia, cualquiera puede llamar `liquidate`: se cobra del
//! colateral lo adeudado y se libera el resto.
//!
//! Colateral y préstamo son el mismo activo, por lo que no hay riesgo de precio ni oráculo.
//! Lo que puede quedar sin cubrir es una pérdida del vault: se registra como deuda incobrable.

#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    panic_with_error, token, Address, BytesN, Env, Symbol, Vec,
};
use stellar_access::access_control::{self as access_control, AccessControl};
use stellar_contract_utils::{
    pausable::{self as pausable, Pausable},
    upgradeable::{self as upgradeable, Upgradeable},
};
use stellar_macros::{only_admin, only_role, when_not_paused};

const DAY_IN_LEDGERS: u32 = 17_280;
pub const TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
pub const TTL_EXTEND_TO: u32 = 90 * DAY_IN_LEDGERS;

const BPS: i128 = 10_000;
const MONTHS_PER_YEAR: i128 = 12;
/// Plazo más largo que se ofrece.
const MAX_TERM_MONTHS: i128 = 12;
/// Tope de deuda a plazo máximo frente al colateral. El margen restante absorbe
/// una pérdida del vault antes de que la deuda quede sin cubrir.
const MAX_DEBT_TO_COLLATERAL_BPS: i128 = 9_500;

// Interfaces mínimas. No se depende de los crates de los otros contratos porque
// eso exporta sus funciones dentro de este Wasm.
#[contractclient(name = "SbtClient")]
pub trait SbtInterface {
    fn get_tier(e: Env, user: Address) -> u32;
}

#[contractclient(name = "SavingsClient")]
pub trait SavingsInterface {
    fn get_token(e: Env) -> Address;
    fn get_free_position(e: Env, user: Address) -> i128;
    fn lock(e: Env, caller: Address, user: Address, assets: i128) -> i128;
    fn unlock(e: Env, caller: Address, user: Address, shares: i128);
    fn seize(e: Env, caller: Address, user: Address, assets: i128, to: Address) -> (i128, i128);
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    InvalidAmount = 1,
    InvalidTerm = 2,
    NotEligible = 3,
    ExceedsTierLimit = 4,
    ActiveLoan = 5,
    NoActiveLoan = 6,
    InsufficientLiquidity = 7,
    NotLiquidatable = 8,
    NothingToWithdraw = 9,
    InvalidConfig = 10,
}

// ─── Storage ─────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Token,
    Sbt,
    Savings,
    Config,
    Loan(Address),
    History(Address),
    /// Wallet de tesorería: única autorizada a retirar el interés acumulado.
    Treasury,
    /// Interés cobrado (ganancia del negocio) disponible para retiro.
    AccruedInterest,
    /// Principal prestado que aún no vuelve al pool.
    TotalBorrowed,
    /// Principal e interés que el colateral no alcanzó a cubrir.
    BadDebt,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TierTerms {
    /// Parte del colateral que se puede prestar, en basis points.
    pub ltv_bps: u32,
    pub max_principal: i128,
}

/// Parámetros de préstamos nuevos. Un préstamo vigente conserva los suyos.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoanConfig {
    /// Interés anual simple, en basis points.
    pub apy_bps: u32,
    /// 2,592,000 en producción; menos en una demo.
    pub seconds_per_month: u64,
    /// Tiempo después del vencimiento en el que no se puede liquidar.
    pub grace_period: u64,
    pub plata: TierTerms,
    pub oro: TierTerms,
    pub diamante: TierTerms,
    pub platino: TierTerms,
}

#[contracttype]
#[derive(Clone, Default, Debug, Eq, PartialEq)]
pub struct Loan {
    /// Principal desembolsado (sin intereses).
    pub principal: i128,
    pub principal_due: i128,
    pub interest_due: i128,
    /// `principal_due + interest_due`.
    pub total_owed: i128,
    pub due_timestamp: u64,
    /// Desde este momento se puede liquidar.
    pub liquidatable_at: u64,
    pub months: u64,
    pub apy_bps: u64,
    /// Shares de `staking_pool` bloqueadas como garantía.
    pub collateral_shares: i128,
}

/// Historial de pagos para la reputación. Los campos que se agreguen en una
/// versión futura deben ser `Option` para poder leer lo ya guardado.
#[contracttype]
#[derive(Clone, Default, Debug, Eq, PartialEq)]
pub struct LoanHistory {
    pub repaid_on_time: u32,
    pub repaid_late: u32,
    pub defaults: u32,
    pub last_default_at: u64,
}

/// Lo que costaría un préstamo con la configuración actual.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoanQuote {
    pub interest: i128,
    pub total_owed: i128,
    pub required_collateral: i128,
    pub duration: u64,
}

// ─── Eventos ─────────────────────────────────────────────────────────────────

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoanRequested {
    #[topic]
    pub user: Address,
    pub principal: i128,
    pub interest: i128,
    pub due_timestamp: u64,
    pub collateral_shares: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoanRepaid {
    #[topic]
    pub user: Address,
    pub amount: i128,
    pub remaining: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoanLiquidated {
    #[topic]
    pub user: Address,
    pub owed: i128,
    pub recovered: i128,
    pub shortfall: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfigUpdated {
    pub config: LoanConfig,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TreasuryWithdrawal {
    #[topic]
    pub treasury: Address,
    pub amount: i128,
}

#[contract]
pub struct VinculoLending;

#[contractimpl]
impl VinculoLending {
    /// El deploy y la inicialización ocurren en la misma transacción, así que
    /// nadie puede adelantarse a fijar el admin, el SBT o la tesorería. El token
    /// se lee del ahorro: el colateral y el préstamo siempre son el mismo activo.
    pub fn __constructor(
        env: Env,
        admin: Address,
        pauser: Address,
        savings: Address,
        sbt: Address,
        treasury: Address,
        config: LoanConfig,
    ) {
        if let Err(error) = check_config(&config) {
            panic_with_error!(&env, error);
        }
        access_control::set_admin(&env, &admin);
        access_control::grant_role_no_auth(&env, &pauser, &Symbol::new(&env, "pauser"), &admin);
        let token = SavingsClient::new(&env, &savings).get_token();
        let storage = env.storage().instance();
        storage.set(&DataKey::Token, &token);
        storage.set(&DataKey::Savings, &savings);
        storage.set(&DataKey::Sbt, &sbt);
        storage.set(&DataKey::Treasury, &treasury);
        storage.set(&DataKey::Config, &config);
        extend_instance(&env);
    }

    /// Cambia los parámetros de préstamos nuevos. Solo el admin.
    #[only_admin]
    pub fn set_config(env: Env, config: LoanConfig) -> Result<(), Error> {
        check_config(&config)?;
        env.storage().instance().set(&DataKey::Config, &config);
        ConfigUpdated { config }.publish(&env);
        extend_instance(&env);
        Ok(())
    }

    /// Cambia la tesorería. Firman el admin y la cuenta nueva, para que un error
    /// de dedo no deje las ganancias en una dirección que nadie controla.
    #[only_admin]
    pub fn set_treasury(env: Env, new_treasury: Address) {
        new_treasury.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::Treasury, &new_treasury);
        extend_instance(&env);
    }

    /// Aporta liquidez al pool de préstamos (el `from` transfiere al contrato).
    pub fn fund_pool(env: Env, from: Address, amount: i128) -> Result<(), Error> {
        from.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        token_client(&env).transfer(&from, env.current_contract_address(), &amount);
        extend_instance(&env);
        Ok(())
    }

    /// Solicita préstamo: lee el tier, bloquea el colateral en el ahorro y
    /// transfiere al usuario. Sin suficiente ahorro libre, revierte.
    #[when_not_paused]
    pub fn request_loan(env: Env, user: Address, amount: i128, months: u64) -> Result<(), Error> {
        user.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        check_term(months)?;
        let loan_key = DataKey::Loan(user.clone());
        if env.storage().persistent().has(&loan_key) {
            return Err(Error::ActiveLoan);
        }

        let config = read_config(&env);
        let terms = terms_for_user(&env, &config, &user)?;
        if amount > terms.max_principal {
            return Err(Error::ExceedsTierLimit);
        }
        if amount > free_liquidity(&env) {
            return Err(Error::InsufficientLiquidity);
        }

        let this = env.current_contract_address();
        let quote = build_quote(&config, &terms, amount, months);
        let collateral_shares = savings_client(&env).lock(&this, &user, &quote.required_collateral);

        token_client(&env).transfer(&this, &user, &amount);

        let due_timestamp = env.ledger().timestamp() + quote.duration;
        let loan = Loan {
            principal: amount,
            principal_due: amount,
            interest_due: quote.interest,
            total_owed: quote.total_owed,
            due_timestamp,
            liquidatable_at: due_timestamp + config.grace_period,
            months,
            apy_bps: u64::from(config.apy_bps),
            collateral_shares,
        };
        write_loan(&env, &loan_key, &loan);
        add_i128(&env, &DataKey::TotalBorrowed, amount);
        LoanRequested {
            user,
            principal: amount,
            interest: quote.interest,
            due_timestamp,
            collateral_shares,
        }
        .publish(&env);
        Ok(())
    }

    /// Abona al préstamo, primero al interés y luego al principal. El excedente
    /// no se cobra. Al saldar libera el colateral. Nunca se pausa.
    pub fn repay(env: Env, user: Address, amount: i128) -> Result<(), Error> {
        user.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let loan_key = DataKey::Loan(user.clone());
        let mut loan = read_loan(&env, &user).ok_or(Error::NoActiveLoan)?;

        let this = env.current_contract_address();
        let pay = amount.min(loan.total_owed);
        token_client(&env).transfer(&user, &this, &pay);
        apply_payment(&env, &mut loan, pay);

        if loan.total_owed == 0 {
            savings_client(&env).unlock(&this, &user, &loan.collateral_shares);
            let mut history = read_history(&env, &user);
            if env.ledger().timestamp() <= loan.due_timestamp {
                history.repaid_on_time += 1;
            } else {
                history.repaid_late += 1;
            }
            write_history(&env, &user, &history);
            env.storage().persistent().remove(&loan_key);
            extend_instance(&env);
        } else {
            write_loan(&env, &loan_key, &loan);
        }
        LoanRepaid {
            user,
            amount: pay,
            remaining: loan.total_owed,
        }
        .publish(&env);
        Ok(())
    }

    /// Cobra del colateral un préstamo vencido después del periodo de gracia y
    /// libera lo que sobre. Cualquiera puede llamarla: el resultado no depende de
    /// quién llama. Devuelve lo recuperado.
    #[when_not_paused]
    pub fn liquidate(env: Env, user: Address) -> Result<i128, Error> {
        let loan_key = DataKey::Loan(user.clone());
        let mut loan = read_loan(&env, &user).ok_or(Error::NoActiveLoan)?;
        if env.ledger().timestamp() < loan.liquidatable_at {
            return Err(Error::NotLiquidatable);
        }

        let this = env.current_contract_address();
        let savings = savings_client(&env);
        let owed = loan.total_owed;
        let (received, burned) = savings.seize(&this, &user, &owed, &this);
        if burned < loan.collateral_shares {
            savings.unlock(&this, &user, &(loan.collateral_shares - burned));
        }

        let recovered = received.min(owed);
        // El redondeo del vault puede entregar de más: eso es del usuario.
        if received > recovered {
            token_client(&env).transfer(&this, &user, &(received - recovered));
        }
        apply_payment(&env, &mut loan, recovered);

        // Lo que falta ya no volverá al pool.
        let shortfall = loan.total_owed;
        if shortfall > 0 {
            add_i128(&env, &DataKey::BadDebt, shortfall);
            add_i128(&env, &DataKey::TotalBorrowed, -loan.principal_due);
        }

        let mut history = read_history(&env, &user);
        history.defaults += 1;
        history.last_default_at = env.ledger().timestamp();
        write_history(&env, &user, &history);
        env.storage().persistent().remove(&loan_key);
        extend_instance(&env);

        LoanLiquidated {
            user,
            owed,
            recovered,
            shortfall,
        }
        .publish(&env);
        Ok(recovered)
    }

    /// Retira ganancia (interés cobrado) hacia la wallet de tesorería.
    /// Solo la tesorería puede llamarla (`treasury.require_auth()`). Nunca retira
    /// más que el interés acumulado ni más que el balance disponible, de modo que
    /// el principal del pool permanece intacto para seguir otorgando préstamos.
    /// Devuelve el monto efectivamente retirado.
    #[when_not_paused]
    pub fn withdraw_interest(env: Env, amount: i128) -> Result<i128, Error> {
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let treasury = read_treasury(&env);
        treasury.require_auth();

        let token = token_client(&env);
        let this = env.current_contract_address();
        let accrued = read_i128(&env, &DataKey::AccruedInterest);
        let withdrawable = amount.min(accrued).min(token.balance(&this));
        if withdrawable <= 0 {
            return Err(Error::NothingToWithdraw);
        }

        token.transfer(&this, &treasury, &withdrawable);
        add_i128(&env, &DataKey::AccruedInterest, -withdrawable);
        TreasuryWithdrawal {
            treasury,
            amount: withdrawable,
        }
        .publish(&env);
        Ok(withdrawable)
    }

    /// Retira liquidez (principal) del pool hacia la tesorería. A diferencia de
    /// `withdraw_interest`, esta saca el capital destinado a préstamos: sirve para
    /// no dejar dinero muerto si la app deja de usarse. El tope es el balance
    /// LIBRE = balance del contrato menos el interés aún no retirado.
    /// Solo la tesorería puede llamarla (`treasury.require_auth()`).
    /// Devuelve el monto efectivamente retirado.
    #[when_not_paused]
    pub fn withdraw_pool(env: Env, amount: i128) -> Result<i128, Error> {
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let treasury = read_treasury(&env);
        treasury.require_auth();

        let withdrawable = amount.min(free_liquidity(&env));
        if withdrawable <= 0 {
            return Err(Error::NothingToWithdraw);
        }

        let this = env.current_contract_address();
        token_client(&env).transfer(&this, &treasury, &withdrawable);
        extend_instance(&env);
        TreasuryWithdrawal {
            treasury,
            amount: withdrawable,
        }
        .publish(&env);
        Ok(withdrawable)
    }

    /// Interés cobrado disponible para que la tesorería retire.
    pub fn get_accrued_interest(env: Env) -> i128 {
        read_i128(&env, &DataKey::AccruedInterest)
    }

    /// Principal prestado que aún no vuelve al pool.
    pub fn get_total_borrowed(env: Env) -> i128 {
        read_i128(&env, &DataKey::TotalBorrowed)
    }

    /// Lo que el colateral no alcanzó a cubrir, acumulado.
    pub fn get_bad_debt(env: Env) -> i128 {
        read_i128(&env, &DataKey::BadDebt)
    }

    /// Wallet de tesorería configurada.
    pub fn get_treasury(env: Env) -> Address {
        read_treasury(&env)
    }

    pub fn get_config(env: Env) -> LoanConfig {
        read_config(&env)
    }

    /// Préstamo vigente del usuario, o todo en cero si no tiene.
    pub fn get_loan(env: Env, user: Address) -> Loan {
        read_loan(&env, &user).unwrap_or_default()
    }

    pub fn get_history(env: Env, user: Address) -> LoanHistory {
        read_history(&env, &user)
    }

    /// `true` si `liquidate` ya procede para este usuario.
    pub fn is_liquidatable(env: Env, user: Address) -> bool {
        read_loan(&env, &user).is_some_and(|loan| env.ledger().timestamp() >= loan.liquidatable_at)
    }

    /// Interés, deuda y colateral de un préstamo con la configuración actual.
    pub fn quote(env: Env, user: Address, amount: i128, months: u64) -> Result<LoanQuote, Error> {
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        check_term(months)?;
        let config = read_config(&env);
        let terms = terms_for_user(&env, &config, &user)?;
        Ok(build_quote(&config, &terms, amount, months))
    }

    /// Lo máximo que el usuario podría pedir hoy: el menor entre su tope, lo que
    /// respalda su ahorro libre y la liquidez del pool. Cero si no es elegible.
    pub fn get_max_principal(env: Env, user: Address) -> i128 {
        if env.storage().persistent().has(&DataKey::Loan(user.clone())) {
            return 0;
        }
        let config = read_config(&env);
        let Ok(terms) = terms_for_user(&env, &config, &user) else {
            return 0;
        };
        let free = savings_client(&env).get_free_position(&user);
        let backed = free * i128::from(terms.ltv_bps) / BPS;
        backed
            .min(terms.max_principal)
            .min(free_liquidity(&env))
            .max(0)
    }

    /// Saldo del token en custodia del contrato (incluye el interés de tesorería).
    pub fn get_pool_balance(env: Env) -> i128 {
        token_client(&env).balance(&env.current_contract_address())
    }
}

#[contractimpl]
impl Pausable for VinculoLending {
    fn paused(e: &Env) -> bool {
        pausable::paused(e)
    }

    #[only_role(caller, "pauser")]
    fn pause(e: &Env, caller: Address) {
        pausable::pause(e);
    }

    /// Despausar es del admin: una llave de pausa robada no puede reanudar.
    #[only_admin]
    fn unpause(e: &Env, caller: Address) {
        let _ = caller;
        pausable::unpause(e);
    }
}

#[contractimpl]
impl Upgradeable for VinculoLending {
    #[only_admin]
    fn upgrade(e: &Env, new_wasm_hash: BytesN<32>, operator: Address) {
        let _ = operator;
        upgradeable::upgrade(e, &new_wasm_hash);
    }
}

#[contractimpl(contracttrait)]
impl AccessControl for VinculoLending {}

// ─── Reglas ──────────────────────────────────────────────────────────────────

fn check_term(months: u64) -> Result<(), Error> {
    match months {
        1 | 3 | 6 | 12 => Ok(()),
        _ => Err(Error::InvalidTerm),
    }
}

/// El interés es fijo y a plazo máximo la deuda debe dejar margen frente al
/// colateral. Sin esto, un LTV alto queda sin respaldo antes de vencer.
fn check_config(config: &LoanConfig) -> Result<(), Error> {
    if config.apy_bps == 0 || config.seconds_per_month == 0 {
        return Err(Error::InvalidConfig);
    }
    let max_interest_factor = BPS + i128::from(config.apy_bps) * MAX_TERM_MONTHS / MONTHS_PER_YEAR;
    for terms in [
        &config.plata,
        &config.oro,
        &config.diamante,
        &config.platino,
    ] {
        let debt_to_collateral = i128::from(terms.ltv_bps) * max_interest_factor / BPS;
        if terms.ltv_bps == 0
            || terms.max_principal <= 0
            || debt_to_collateral > MAX_DEBT_TO_COLLATERAL_BPS
        {
            return Err(Error::InvalidConfig);
        }
    }
    Ok(())
}

fn terms_for_user(env: &Env, config: &LoanConfig, user: &Address) -> Result<TierTerms, Error> {
    let sbt: Address = env.storage().instance().get(&DataKey::Sbt).unwrap();
    match SbtClient::new(env, &sbt).get_tier(user) {
        1 => Ok(config.plata.clone()),
        2 => Ok(config.oro.clone()),
        3 => Ok(config.diamante.clone()),
        4 => Ok(config.platino.clone()),
        _ => Err(Error::NotEligible),
    }
}

/// Interés y colateral redondean hacia arriba, a favor del pool.
fn build_quote(config: &LoanConfig, terms: &TierTerms, amount: i128, months: u64) -> LoanQuote {
    let interest = ceil_div(
        amount * i128::from(config.apy_bps) * i128::from(months),
        MONTHS_PER_YEAR * BPS,
    );
    LoanQuote {
        interest,
        total_owed: amount + interest,
        required_collateral: ceil_div(amount * BPS, i128::from(terms.ltv_bps)),
        duration: months * config.seconds_per_month,
    }
}

fn ceil_div(numerator: i128, denominator: i128) -> i128 {
    (numerator + denominator - 1) / denominator
}

/// Lo cobrado va primero al interés (ganancia) y luego al principal (vuelve al pool).
fn apply_payment(env: &Env, loan: &mut Loan, amount: i128) {
    let to_interest = amount.min(loan.interest_due);
    let to_principal = amount - to_interest;
    loan.interest_due -= to_interest;
    loan.principal_due -= to_principal;
    loan.total_owed -= amount;
    add_i128(env, &DataKey::AccruedInterest, to_interest);
    add_i128(env, &DataKey::TotalBorrowed, -to_principal);
}

/// El interés cobrado es de la tesorería: no se puede prestar ni retirar como liquidez.
fn free_liquidity(env: &Env) -> i128 {
    let balance = token_client(env).balance(&env.current_contract_address());
    balance - read_i128(env, &DataKey::AccruedInterest)
}

// ─── Storage ─────────────────────────────────────────────────────────────────

fn token_client(env: &Env) -> token::Client<'_> {
    let address: Address = env.storage().instance().get(&DataKey::Token).unwrap();
    token::Client::new(env, &address)
}

fn savings_client(env: &Env) -> SavingsClient<'_> {
    let address: Address = env.storage().instance().get(&DataKey::Savings).unwrap();
    SavingsClient::new(env, &address)
}

fn read_config(env: &Env) -> LoanConfig {
    env.storage().instance().get(&DataKey::Config).unwrap()
}

fn read_treasury(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Treasury).unwrap()
}

fn read_i128(env: &Env, key: &DataKey) -> i128 {
    env.storage().instance().get(key).unwrap_or(0)
}

fn add_i128(env: &Env, key: &DataKey, delta: i128) {
    env.storage()
        .instance()
        .set(key, &(read_i128(env, key) + delta));
    extend_instance(env);
}

fn read_loan(env: &Env, user: &Address) -> Option<Loan> {
    env.storage().persistent().get(&DataKey::Loan(user.clone()))
}

fn write_loan(env: &Env, key: &DataKey, loan: &Loan) {
    let storage = env.storage().persistent();
    storage.set(key, loan);
    storage.extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
    extend_instance(env);
}

fn read_history(env: &Env, user: &Address) -> LoanHistory {
    env.storage()
        .persistent()
        .get(&DataKey::History(user.clone()))
        .unwrap_or_default()
}

fn write_history(env: &Env, user: &Address, history: &LoanHistory) {
    let key = DataKey::History(user.clone());
    let storage = env.storage().persistent();
    storage.set(&key, history);
    storage.extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn extend_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

#[cfg(test)]
mod test;
