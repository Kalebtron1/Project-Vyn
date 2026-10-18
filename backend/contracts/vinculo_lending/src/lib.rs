//! VinculoLending — préstamos según tier del SBT (`vinculo_sbt`).
//!
//! Vive en `backend/contracts/vinculo_lending/` junto a `vinculo_sbt` y `staking_pool`.
//! Consulta on-chain el nivel con `VinculoSBTClient::get_tier` (alineado al `vinculo_sbt` actual).
//!
//! Modo demo (hackathon): 1 "mes" de plazo = 60 segundos de ledger, igual que `staking_pool`.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};
use vinculo_sbt::VinculoSBTClient;

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
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Loan {
    /// Principal desembolsado (sin intereses).
    pub principal: i128,
    /// Interés calculado según plazo (`months`) y tasa anual (`apy_bps`).
    pub interest: i128,
    /// Principal + intereses pendientes de pago.
    pub total_owed: i128,
    pub due_timestamp: u64,
    pub months: u64,
    pub apy_bps: u64,
    /// Indica si el préstamo tiene saldo pendiente y venció `due_timestamp`.
    pub overdue: bool,
}

pub const DEFAULT_APY_BPS: u64 = 500;
const MONTHS_PER_YEAR: i128 = 12;
const BPS_DENOMINATOR: i128 = 10_000;

/// Calcula el interés proporcional al plazo (`months`) y la tasa anual (`apy_bps`),
/// redondeando hacia arriba a favor del pool (`div_ceil`).
pub fn compute_interest(principal: i128, apy_bps: u64, months: u64) -> i128 {
    if principal <= 0 || apy_bps == 0 || months == 0 {
        return 0;
    }
    let numerator = principal * (apy_bps as i128) * (months as i128);
    let denominator = MONTHS_PER_YEAR * BPS_DENOMINATOR;
    (numerator + denominator - 1) / denominator
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

        let apy_bps = DEFAULT_APY_BPS;
        let interest = compute_interest(amount, apy_bps, months);
        let total_owed = amount + interest;

        let token_client = token::Client::new(&env, &token_addr);
        let this = env.current_contract_address();
        let pool_balance = token_client.balance(&this);
        assert!(pool_balance >= amount, "insufficient pool liquidity");

        token_client.transfer(&this, &user, &amount);

        let loan = Loan {
            principal: amount,
            interest,
            total_owed,
            due_timestamp: env.ledger().timestamp() + months * 60,
            months,
            apy_bps,
            overdue: false,
        };
        env.storage().persistent().set(&loan_key, &loan);
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

        loan.total_owed -= pay;
        if loan.total_owed == 0 {
            // Préstamo saldado: el interés calculado para el plazo (`loan.interest`)
            // pasa a ganancia retirable por la tesorería. El principal permanece
            // como liquidez del pool para seguir prestando.
            let interest = if loan.interest > 0 {
                loan.interest
            } else {
                compute_interest(loan.principal, loan.apy_bps, loan.months)
            };
            let storage = env.storage().instance();
            let accrued: i128 = storage.get(&DataKey::AccruedInterest).unwrap_or(0);
            storage.set(&DataKey::AccruedInterest, &(accrued + interest));
            loan = Loan::default();
        }
        env.storage().persistent().set(&loan_key, &loan);
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
        loan.overdue = loan.total_owed > 0 && env.ledger().timestamp() > loan.due_timestamp;
        loan
    }

    /// Devuelve `true` cuando el usuario tiene un préstamo activo (`total_owed > 0`)
    /// y el tiempo de ledger actual supera `due_timestamp`.
    pub fn is_overdue(env: Env, user: Address) -> bool {
        let loan: Loan = env
            .storage()
            .persistent()
            .get(&DataKey::Loan(user))
            .unwrap_or_default();
        loan.total_owed > 0 && env.ledger().timestamp() > loan.due_timestamp
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

fn max_principal_for_tier(tier: u32) -> i128 {
    match tier {
        1 => 3_000_000_000,  // Plata (300 XLM)
        2 => 6_000_000_000,  // Oro (600 XLM)
        3 => 15_000_000_000, // Diamante (1,500 XLM)
        4 => 50_000_000_000, // Platino (5,000 XLM)
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::StellarAssetClient,
    };
    use vinculo_sbt::VinculoSBT;

    struct TestEnv {
        env: Env,
        lending: VinculoLendingClient<'static>,
        sbt: VinculoSBTClient<'static>,
        sbt_admin: Address,
        treasury: Address,
        token_admin: StellarAssetClient<'static>,
    }

    fn setup() -> TestEnv {
        let env = Env::default();
        env.mock_all_auths();

        let issuer = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(issuer);
        let token_addr = sac.address();
        let token_admin = StellarAssetClient::new(&env, &token_addr);

        let sbt_admin = Address::generate(&env);
        let sbt_addr = env.register_contract(None, VinculoSBT);
        let sbt = VinculoSBTClient::new(&env, &sbt_addr);
        sbt.init(&sbt_admin);

        let treasury = Address::generate(&env);
        let lending_addr = env.register_contract(None, VinculoLending);
        let lending = VinculoLendingClient::new(&env, &lending_addr);
        lending.init_lending(&token_addr, &sbt_addr, &treasury);

        let funder = Address::generate(&env);
        token_admin.mint(&funder, &500_000_000_000);
        lending.fund_pool(&funder, &500_000_000_000);

        TestEnv {
            env,
            lending,
            sbt,
            sbt_admin,
            treasury,
            token_admin,
        }
    }

    #[test]
    fn test_interest_scales_with_months_and_rounds_for_pool() {
        let t = setup();
        let principal = 1_200_000_000i128; // 120 XLM

        for (months, expected_interest) in [
            (1u64, 5_000_000i128),   // 120 * 500 * 1 / 120_000 = 0.5 XLM
            (3u64, 15_000_000i128),  // 1.5 XLM
            (6u64, 30_000_000i128),  // 3.0 XLM
            (12u64, 60_000_000i128), // 6.0 XLM (5% anual)
        ] {
            let user = Address::generate(&t.env);
            t.sbt.mint(&t.sbt_admin, &user, &1);
            t.lending.request_loan(&user, &principal, &months);

            let loan = t.lending.get_loan(&user);
            assert_eq!(loan.principal, principal);
            assert_eq!(loan.interest, expected_interest);
            assert_eq!(loan.total_owed, principal + expected_interest);
            assert_eq!(loan.months, months);
            assert_eq!(loan.apy_bps, DEFAULT_APY_BPS);
            assert!(!loan.overdue);

            t.token_admin.mint(&user, &expected_interest);
            t.lending.repay(&user, &loan.total_owed);
        }

        // Total interés acumulado tras saldar los 4 préstamos: 0.5 + 1.5 + 3.0 + 6.0 = 11.0 XLM
        assert_eq!(t.lending.get_accrued_interest(), 110_000_000);
        let withdrawn = t.lending.withdraw_interest(&110_000_000);
        assert_eq!(withdrawn, 110_000_000);
        assert_eq!(t.lending.get_accrued_interest(), 0);
        let _ = &t.treasury;
    }

    #[test]
    fn test_compute_interest_rounds_up_fractional_stroops() {
        // 100 stroops * 500 bps * 1 mes / 120_000 = 0.4166... -> redondea a 1 stroop
        assert_eq!(compute_interest(100, 500, 1), 1);
    }

    #[test]
    fn test_overdue_state_transitions_after_due_timestamp() {
        let t = setup();
        let user = Address::generate(&t.env);
        t.sbt.mint(&t.sbt_admin, &user, &1);

        t.env.ledger().with_mut(|li| {
            li.timestamp = 1_000;
        });

        t.lending.request_loan(&user, &1_000_000_000, &3);
        let loan = t.lending.get_loan(&user);
        assert_eq!(loan.due_timestamp, 1_180);
        assert!(!loan.overdue);
        assert!(!t.lending.is_overdue(&user));

        // Exactamente en due_timestamp aún no está vencido
        t.env.ledger().with_mut(|li| {
            li.timestamp = 1_180;
        });
        assert!(!t.lending.is_overdue(&user));

        // Un segundo después de due_timestamp pasa a estar en mora
        t.env.ledger().with_mut(|li| {
            li.timestamp = 1_181;
        });
        assert!(t.lending.is_overdue(&user));
        assert!(t.lending.get_loan(&user).overdue);

        // Al pagar el préstamo deja de estar vencido
        t.token_admin.mint(&user, &loan.interest);
        t.lending.repay(&user, &loan.total_owed);
        assert!(!t.lending.is_overdue(&user));
        assert!(!t.lending.get_loan(&user).overdue);
    }
}
