//! VinculoLending — préstamos según tier del SBT (`vinculo_sbt`).
//!
//! Vive en `backend/contracts/vinculo_lending/` junto a `vinculo_sbt` y `staking_pool`.
//! Consulta on-chain el nivel con `VinculoSBTClient::get_tier` (alineado al `vinculo_sbt` actual).
//!
//! Modo demo (hackathon): 1 "mes" de plazo = `SECONDS_PER_MONTH` (60 segundos de ledger).
//!
//! Interés (a favor del pool, redondeo hacia arriba):
//! `ceil(principal * apy_bps * months / (12 * 10_000))`.
//! `apy_bps` es 500 (5% anual). Un préstamo de 12 meses paga el 5% completo;
//! uno de 1 mes paga una doceava parte. El interés calculado se guarda en el
//! préstamo y `repay` usa ese mismo valor, no lo recalcula.
//!
//! Un préstamo con saldo pendiente está vencido cuando
//! `ledger.timestamp >= due_timestamp` (`is_overdue` / `get_loan.is_overdue`).
//! Vencer no revoca el SBT: el score off-chain debe bajar y bloquear subidas
//! de tier hasta el pago. Ver `docs/flows.md`.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, Symbol};
use vinculo_sbt::VinculoSBTClient;

/// 5% anual, en basis points.
const APY_BPS: u64 = 500;
/// 1 mes de plazo en el demo = 60 segundos de ledger.
pub const SECONDS_PER_MONTH: u64 = 60;

// ─── Storage ─────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Token,
    Sbt,
    Loan(Address),
    /// Wallet de tesorería: única autorizada a retirar el interés acumulado.
    Treasury,
    /// Interés acumulado (ganancia del negocio) disponible para retiro.
    AccruedInterest,
}

#[contracttype]
#[derive(Clone, Default)]
pub struct Loan {
    /// Principal desembolsado (sin intereses).
    pub principal: i128,
    /// Principal + intereses pendientes de pago.
    pub total_owed: i128,
    pub due_timestamp: u64,
    pub months: u64,
    pub apy_bps: u64,
    /// Interés fijado al abrir el préstamo. `repay` acredita este monto.
    pub interest: i128,
    /// Se recalcula al leer (`get_loan`). En storage queda en false.
    pub is_overdue: bool,
}

#[contract]
pub struct VinculoLending;

#[contractimpl]
impl VinculoLending {
    /// Guarda dirección del token (SAC / Soroban token), del contrato `VinculoSBT`
    /// y de la wallet de tesorería (la única que podrá retirar el interés).
    ///
    /// La tesorería se fija aquí, en el deploy, y no en una función aparte: así se
    /// evita un *front-running* en el que un atacante la reclame antes que el dueño.
    pub fn init_lending(env: Env, token: Address, sbt: Address, treasury: Address) {
        // Guard de re-inicialización: sin esto, cualquiera podría volver a llamar
        // `init_lending` y re-apuntar el token, el SBT o la tesorería a uno malicioso
        // (p.ej. un SBT que devuelva tier 4 para el atacante) y drenar el pool vía
        // `request_loan`.
        if env.storage().instance().has(&DataKey::Token) {
            panic!("El contrato ya fue inicializado");
        }
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Sbt, &sbt);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        env.events()
            .publish((Symbol::new(&env, "init_lending"), treasury), true);
    }

    /// Aporta liquidez al pool de préstamos (el `from` transfiere al contrato).
    pub fn fund_pool(env: Env, from: Address, amount: i128) {
        from.require_auth();
        assert!(amount > 0, "amount must be > 0");

        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("init not called");
        let client = token::Client::new(&env, &token_addr);
        client.transfer(&from, &env.current_contract_address(), &amount);
        env.events()
            .publish((Symbol::new(&env, "fund_pool"), from), amount);
    }

    /// Solicita préstamo: lee tier en `vinculo_sbt`, valida tope y liquidez, transfiere al usuario.
    pub fn request_loan(env: Env, user: Address, amount: i128, months: u64) {
        user.require_auth();
        assert!(amount > 0, "amount must be > 0");
        assert!(
            months == 1 || months == 3 || months == 6 || months == 12,
            "invalid term (months)"
        );

        // OPT: read Token and Sbt in a single storage access chain — avoids a second
        // instance-storage round-trip that was previously a separate .get() call
        let storage = env.storage().instance();
        let token_addr: Address = storage.get(&DataKey::Token).expect("init not called");
        let sbt_addr: Address = storage.get(&DataKey::Sbt).expect("init not called");

        let sbt_client = VinculoSBTClient::new(&env, &sbt_addr);
        let tier = sbt_client.get_tier(&user);
        assert!((1..=4).contains(&tier), "no valid SBT tier for credit");

        // OPT: build loan key once — eliminates 3 redundant user.clone() calls
        let loan_key = DataKey::Loan(user.clone());
        let existing: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .unwrap_or_default();
        assert!(existing.total_owed == 0, "active loan exists");

        let max = max_principal_for_tier(tier);
        assert!(amount <= max, "amount exceeds tier limit");

        let interest = interest_for(amount, APY_BPS, months);
        let total_owed = amount + interest;

        let token_client = token::Client::new(&env, &token_addr);
        let this = env.current_contract_address();
        let pool_balance = token_client.balance(&this);
        assert!(pool_balance >= amount, "insufficient pool liquidity");

        token_client.transfer(&this, &user, &amount);

        let loan = Loan {
            principal: amount,
            total_owed,
            due_timestamp: env.ledger().timestamp() + months * SECONDS_PER_MONTH,
            months,
            apy_bps: APY_BPS,
            interest,
            is_overdue: false,
        };
        env.storage().persistent().set(&loan_key, &loan);
        env.events().publish(
            (Symbol::new(&env, "loan"), user),
            (amount, months, total_owed),
        );
    }

    /// Abona al préstamo (total o parcial). El excedente no se acepta.
    pub fn repay(env: Env, user: Address, amount: i128) {
        user.require_auth();
        assert!(amount > 0, "amount must be > 0");

        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("init not called");

        // OPT: build loan key once — eliminates redundant user.clone()
        let loan_key = DataKey::Loan(user.clone());
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .unwrap_or_default();
        assert!(loan.total_owed > 0, "no active loan");

        let pay = amount.min(loan.total_owed);
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&user, &env.current_contract_address(), &pay);

        let interest = loan.interest;
        loan.total_owed -= pay;
        if loan.total_owed == 0 {
            // Préstamo saldado: el interés guardado al abrir el préstamo pasa
            // a ganancia retirable por la tesorería. El principal permanece
            // como liquidez del pool para seguir prestando.
            let storage = env.storage().instance();
            let accrued: i128 = storage.get(&DataKey::AccruedInterest).unwrap_or(0);
            storage.set(&DataKey::AccruedInterest, &(accrued + interest));
            loan = Loan::default();
        }
        env.storage().persistent().set(&loan_key, &loan);
        env.events()
            .publish((Symbol::new(&env, "repay"), user), (pay, loan.total_owed));
    }

    /// Retira ganancia (interés acumulado) hacia la wallet de tesorería.
    /// Solo la tesorería puede llamarla (`treasury.require_auth()`). Nunca retira
    /// más que el interés acumulado ni más que el balance disponible, de modo que
    /// el principal del pool permanece intacto para seguir otorgando préstamos.
    /// Devuelve el monto efectivamente retirado.
    pub fn withdraw_interest(env: Env, amount: i128) -> i128 {
        assert!(amount > 0, "amount must be > 0");

        let storage = env.storage().instance();
        let treasury: Address = storage.get(&DataKey::Treasury).expect("init not called");
        treasury.require_auth();

        let accrued: i128 = storage.get(&DataKey::AccruedInterest).unwrap_or(0);
        assert!(accrued > 0, "no interest accrued");

        let token_addr: Address = storage.get(&DataKey::Token).expect("init not called");
        let token_client = token::Client::new(&env, &token_addr);
        let this = env.current_contract_address();
        let balance = token_client.balance(&this);

        // Tope doble: ni más que lo acumulado ni más que el balance disponible.
        let withdrawable = amount.min(accrued).min(balance);
        assert!(withdrawable > 0, "nothing to withdraw");

        token_client.transfer(&this, &treasury, &withdrawable);
        storage.set(&DataKey::AccruedInterest, &(accrued - withdrawable));
        env.events().publish(
            (Symbol::new(&env, "withdraw_interest"), treasury),
            withdrawable,
        );
        withdrawable
    }

    /// Retira liquidez (principal) del pool hacia la tesorería. A diferencia de
    /// `withdraw_interest`, esta saca el capital destinado a préstamos: sirve para
    /// no dejar dinero muerto si la app deja de usarse. Nunca toca el interés
    /// acumulado (que se retira con `withdraw_interest`): el tope es el balance
    /// LIBRE = balance del contrato menos el interés aún no retirado, de modo que
    /// el balance nunca cae por debajo del interés reservado a la tesorería.
    /// Solo la tesorería puede llamarla (`treasury.require_auth()`).
    /// Devuelve el monto efectivamente retirado.
    pub fn withdraw_pool(env: Env, amount: i128) -> i128 {
        assert!(amount > 0, "amount must be > 0");

        let storage = env.storage().instance();
        let treasury: Address = storage.get(&DataKey::Treasury).expect("init not called");
        treasury.require_auth();

        let token_addr: Address = storage.get(&DataKey::Token).expect("init not called");
        let token_client = token::Client::new(&env, &token_addr);
        let this = env.current_contract_address();
        let balance = token_client.balance(&this);
        let accrued: i128 = storage.get(&DataKey::AccruedInterest).unwrap_or(0);

        // Liquidez libre = balance − interés acumulado (el interés se retira aparte).
        let free = balance - accrued;
        let withdrawable = amount.min(free);
        assert!(withdrawable > 0, "nothing to withdraw");

        token_client.transfer(&this, &treasury, &withdrawable);
        env.events()
            .publish((Symbol::new(&env, "withdraw_pool"), treasury), withdrawable);
        withdrawable
    }

    /// Interés acumulado (ganancia) disponible para que la tesorería retire.
    pub fn get_accrued_interest(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::AccruedInterest)
            .unwrap_or(0)
    }

    /// Wallet de tesorería configurada en el deploy.
    pub fn get_treasury(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Treasury)
            .expect("init not called")
    }

    pub fn get_loan(env: Env, user: Address) -> Loan {
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&DataKey::Loan(user))
            .unwrap_or_default();
        loan.is_overdue = loan_is_overdue(&env, &loan);
        loan
    }

    /// true cuando hay deuda y el ledger ya alcanzó `due_timestamp`.
    pub fn is_overdue(env: Env, user: Address) -> bool {
        let loan: Loan = env
            .storage()
            .persistent()
            .get(&DataKey::Loan(user))
            .unwrap_or_default();
        loan_is_overdue(&env, &loan)
    }

    /// Saldo del token en custodia del contrato (liquidez disponible para desembolsos).
    pub fn get_pool_balance(env: Env) -> i128 {
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("init not called");
        let token_client = token::Client::new(&env, &token_addr);
        token_client.balance(&env.current_contract_address())
    }
}

#[cfg(test)]
mod test;

/// `ceil(principal * apy_bps * months / (12 * 10_000))`.
fn interest_for(principal: i128, apy_bps: u64, months: u64) -> i128 {
    let numer = principal * (apy_bps as i128) * (months as i128);
    let denom: i128 = 12 * 10_000;
    if numer <= 0 {
        return 0;
    }
    (numer + denom - 1) / denom
}

fn loan_is_overdue(env: &Env, loan: &Loan) -> bool {
    loan.total_owed > 0 && env.ledger().timestamp() >= loan.due_timestamp
}

fn max_principal_for_tier(tier: u32) -> i128 {
    match tier {
        1 => 300_000_0000,   // Plata
        2 => 600_000_0000,   // Oro
        3 => 1_500_000_0000, // Diamante
        4 => 5_000_000_0000, // Platino
        _ => 0,
    }
}
