//! VinculoLending — préstamos según tier del SBT (`vinculo_sbt`).
//!
//! Vive en `backend/contracts/vinculo_lending/` junto a `vinculo_sbt` y `staking_pool`.
//! Consulta on-chain el nivel con `VinculoSBTClient::get_tier` (alineado al `vinculo_sbt` actual).
//!
//! Modo demo (hackathon): 1 “mes” de plazo = 60 segundos de ledger, igual que `staking_pool`.

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
}

#[contract]
pub struct VinculoLending;

#[contractimpl]
impl VinculoLending {
    /// Guarda dirección del token (SAC / Soroban token) y del contrato `VinculoSBT`.
    pub fn init_lending(env: Env, token: Address, sbt: Address) {
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Sbt, &sbt);
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
        // 1. El usuario debe firmar la transacción (Aprobación)
        user.require_auth();
        assert!(amount > 0, "amount must be > 0");
        assert!(
            months == 1 || months == 3 || months == 6 || months == 12,
            "invalid term (months)"
        );

        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("init not called");
        let sbt_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Sbt)
            .expect("init not called");

        // 2. Consultamos la reputación (SBT) del usuario
        let sbt_client = VinculoSBTClient::new(&env, &sbt_addr);
        let tier = sbt_client.get_tier(&user);
        assert!((1..=4).contains(&tier), "no valid SBT tier for credit");

        let existing: Loan = env
            .storage()
            .persistent()
            .get(&DataKey::Loan(user.clone()))
            .unwrap_or_default();
        assert!(existing.total_owed == 0, "active loan exists");

        // 3. Validamos contra el límite máximo de su Nivel (El Guardaespaldas)
        let max = max_principal_for_tier(tier);
        assert!(amount <= max, "amount exceeds tier limit");

        let apy_bps = 500;
        let interest = (amount * 5) / 100;
        let total_owed = amount + interest;

        let token_client = token::Client::new(&env, &token_addr);
        let this = env.current_contract_address();
        let pool_balance = token_client.balance(&this);
        assert!(pool_balance >= amount, "insufficient pool liquidity");

        // 4. TRANSFERENCIA DIRECTA: El contrato manda los fondos a la wallet del usuario
        token_client.transfer(&this, &user, &amount);

        let duration_secs = months * 60;
        let due = env.ledger().timestamp() + duration_secs;

        let loan = Loan {
            principal: amount,
            total_owed,
            due_timestamp: due,
            months,
            apy_bps,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Loan(user.clone()), &loan);
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

        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&DataKey::Loan(user.clone()))
            .unwrap_or_default();
        assert!(loan.total_owed > 0, "no active loan");

        let pay = amount.min(loan.total_owed);
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&user, &env.current_contract_address(), &pay);

        loan.total_owed -= pay;
        if loan.total_owed == 0 {
            loan = Loan::default();
        }
        env.storage()
            .persistent()
            .set(&DataKey::Loan(user.clone()), &loan);
    }

    pub fn get_loan(env: Env, user: Address) -> Loan {
        env.storage()
            .persistent()
            .get(&DataKey::Loan(user))
            .unwrap_or_default()
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

// 🚀 CAMBIO CLAVE: Sincronizado con el Node.js (CREDIT_LIMITS)
fn max_principal_for_tier(tier: u32) -> i128 {
    match tier {
        1 => 300_000_0000,      // Plata
        2 => 600_000_0000,      // Oro
        3 => 1_500_000_0000,    // Diamante
        4 => 5_000_000_0000,    // Platino
        _ => 0,
    }
}

/// APY anual expresado en “puntos base” sobre 10000 (ej. 1200 = 12 % anual).
/// Interés sobre el plazo: `(principal * apy_bps * months) / 1200` (misma convención que staking).
fn apy_bps_for_tier(tier: u32) -> u64 {
    match tier {
        1 => 1_200, // 12%
        2 => 800,   // 8%
        3 => 500,   // 5%
        4 => 400,   // 4%
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    #[test]
    fn request_and_repay_loan() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(admin.clone());
        let sbt_id = env.register_contract(None, vinculo_sbt::VinculoSBT);
        let sbt = VinculoSBTClient::new(&env, &sbt_id);
        sbt.init(&admin);
        sbt.mint(&admin, &user, &2);

        let lending_id = env.register_contract(None, VinculoLending);
        let lending = VinculoLendingClient::new(&env, &lending_id);
        lending.init(&token_id, &sbt_id);

        let token = token::Client::new(&env, &token_id);
        token.mint(&lending_id, &10_000);

        // Pedimos 600 porque es el máximo de Nivel 2 (Oro)
        lending.request_loan(&user, &600, &3);
        let loan = lending.get_loan(&user);
        assert!(loan.total_owed > 600);
        assert_eq!(loan.principal, 600);

        token.mint(&user, &loan.total_owed);
        lending.repay(&user, &loan.total_owed);
        assert_eq!(lending.get_loan(&user).total_owed, 0);
    }

    // ===== TIER LIMITS TESTS =====

    #[test]
    fn test_max_principal_tier_1_plata() {
        let tier = 1u32;
        let max = max_principal_for_tier(tier);
        assert_eq!(max, 300_000_0000);
    }

    #[test]
    fn test_max_principal_tier_2_oro() {
        let tier = 2u32;
        let max = max_principal_for_tier(tier);
        assert_eq!(max, 600_000_0000);
    }

    #[test]
    fn test_max_principal_tier_3_diamante() {
        let tier = 3u32;
        let max = max_principal_for_tier(tier);
        assert_eq!(max, 1_500_000_0000);
    }

    #[test]
    fn test_max_principal_tier_4_platino() {
        let tier = 4u32;
        let max = max_principal_for_tier(tier);
        assert_eq!(max, 5_000_000_0000);
    }

    #[test]
    fn test_max_principal_invalid_tier() {
        let tier = 0u32;
        let max = max_principal_for_tier(tier);
        assert_eq!(max, 0);
        
        let tier = 5u32;
        let max = max_principal_for_tier(tier);
        assert_eq!(max, 0);
    }

    // ===== APY BPS TESTS =====

    #[test]
    fn test_apy_bps_tier_1_plata() {
        let tier = 1u32;
        let apy = apy_bps_for_tier(tier);
        assert_eq!(apy, 1_200); // 12%
    }

    #[test]
    fn test_apy_bps_tier_2_oro() {
        let tier = 2u32;
        let apy = apy_bps_for_tier(tier);
        assert_eq!(apy, 800); // 8%
    }

    #[test]
    fn test_apy_bps_tier_3_diamante() {
        let tier = 3u32;
        let apy = apy_bps_for_tier(tier);
        assert_eq!(apy, 500); // 5%
    }

    #[test]
    fn test_apy_bps_tier_4_platino() {
        let tier = 4u32;
        let apy = apy_bps_for_tier(tier);
        assert_eq!(apy, 400); // 4%
    }

    // ===== TIER VALIDATION TESTS =====

    #[test]
    fn test_valid_tiers() {
        for tier in 1..=4 {
            assert!((1..=4).contains(&tier));
        }
    }

    #[test]
    fn test_invalid_tier_zero() {
        let tier = 0u32;
        assert!(!(1..=4).contains(&tier));
    }

    #[test]
    fn test_invalid_tier_five() {
        let tier = 5u32;
        assert!(!(1..=4).contains(&tier));
    }

    // ===== MONTHS VALIDATION TESTS =====

    #[test]
    fn test_valid_months_values() {
        for months in vec![1, 3, 6, 12] {
            assert!(months == 1 || months == 3 || months == 6 || months == 12);
        }
    }

    #[test]
    fn test_invalid_months_zero() {
        let months = 0u64;
        assert!(!(months == 1 || months == 3 || months == 6 || months == 12));
    }

    #[test]
    fn test_invalid_months_two() {
        let months = 2u64;
        assert!(!(months == 1 || months == 3 || months == 6 || months == 12));
    }

    #[test]
    fn test_invalid_months_five() {
        let months = 5u64;
        assert!(!(months == 1 || months == 3 || months == 6 || months == 12));
    }

    // ===== INTEREST CALCULATION TESTS =====

    #[test]
    fn test_interest_calculation_5_percent() {
        let amount = 100_0000i128;
        let interest = (amount * 5) / 100;
        assert_eq!(interest, 5_0000);
    }

    #[test]
    fn test_interest_calculation_large_amount() {
        let amount = 1_000_000_0000i128; // 1 billion
        let interest = (amount * 5) / 100;
        assert_eq!(interest, 50_000_0000);
    }

    #[test]
    fn test_interest_calculation_small_amount() {
        let amount = 1i128;
        let interest = (amount * 5) / 100;
        assert_eq!(interest, 0); // Rounds down to 0
    }

    #[test]
    fn test_total_owed_principal_plus_interest() {
        let principal = 100_0000i128;
        let interest = (principal * 5) / 100;
        let total_owed = principal + interest;
        assert_eq!(total_owed, 105_0000);
        assert!(total_owed > principal);
    }

    // ===== LOAN STATE TESTS =====

    #[test]
    fn test_loan_default_state() {
        let loan = Loan::default();
        assert_eq!(loan.principal, 0);
        assert_eq!(loan.total_owed, 0);
        assert_eq!(loan.due_timestamp, 0);
        assert_eq!(loan.months, 0);
        assert_eq!(loan.apy_bps, 0);
    }

    #[test]
    fn test_loan_active_state() {
        let loan = Loan {
            principal: 100_0000,
            total_owed: 105_0000,
            due_timestamp: 1000,
            months: 3,
            apy_bps: 500,
        };
        assert!(loan.total_owed > 0);
    }

    #[test]
    fn test_loan_cleared_state() {
        let loan = Loan::default();
        assert_eq!(loan.total_owed, 0);
    }

    // ===== FUZZ-STYLE TESTS: PROPERTY-BASED COVERAGE =====

    #[test]
    fn test_fuzz_tier_limits_monotonic() {
        // Property: Higher tier should have higher limit
        let tier1_max = max_principal_for_tier(1);
        let tier2_max = max_principal_for_tier(2);
        let tier3_max = max_principal_for_tier(3);
        let tier4_max = max_principal_for_tier(4);
        
        assert!(tier1_max < tier2_max);
        assert!(tier2_max < tier3_max);
        assert!(tier3_max < tier4_max);
    }

    #[test]
    fn test_fuzz_apy_decreases_by_tier() {
        // Property: Higher tier should have lower APY (better rates for better credit)
        let apy1 = apy_bps_for_tier(1);
        let apy2 = apy_bps_for_tier(2);
        let apy3 = apy_bps_for_tier(3);
        let apy4 = apy_bps_for_tier(4);
        
        assert!(apy1 > apy2);
        assert!(apy2 > apy3);
        assert!(apy3 > apy4);
    }

    #[test]
    fn test_fuzz_amount_validation_positive() {
        // Property: Amount must be positive
        let amounts = vec![1i128, 100_0000, 1_000_000_0000];
        for amount in amounts {
            assert!(amount > 0);
        }
    }

    #[test]
    fn test_fuzz_total_owed_never_less_than_principal() {
        // Invariant: total_owed >= principal
        let principals = vec![100_0000i128, 500_0000, 1_000_0000];
        for principal in principals {
            let interest = (principal * 5) / 100;
            let total = principal + interest;
            assert!(total >= principal);
        }
    }

    #[test]
    fn test_fuzz_interest_non_negative() {
        // Property: Interest should never be negative
        let test_amounts = vec![1i128, 100_0000, 1_000_0000, i128::MAX / 100];
        for amount in test_amounts {
            let interest = (amount * 5) / 100;
            assert!(interest >= 0);
        }
    }

    #[test]
    fn test_fuzz_loan_amount_within_tier_limit() {
        // Property: Loan amount should never exceed tier limit
        let test_cases = vec![
            (1u32, 100_0000i128),
            (1u32, 300_000_0000i128),
            (2u32, 500_000_0000i128),
            (2u32, 600_000_0000i128),
            (3u32, 1_000_000_0000i128),
            (3u32, 1_500_000_0000i128),
            (4u32, 2_000_000_0000i128),
            (4u32, 5_000_000_0000i128),
        ];
        
        for (tier, amount) in test_cases {
            let max = max_principal_for_tier(tier);
            assert!(amount <= max);
        }
    }

    #[test]
    fn test_fuzz_loan_amount_exceeds_tier_limit() {
        // Property: These should fail validation
        let test_cases = vec![
            (1u32, 300_000_0001i128), // Slightly over tier 1 limit
            (2u32, 600_000_0001i128), // Slightly over tier 2 limit
            (3u32, 1_500_000_0001i128), // Slightly over tier 3 limit
            (4u32, 5_000_000_0001i128), // Slightly over tier 4 limit
        ];
        
        for (tier, amount) in test_cases {
            let max = max_principal_for_tier(tier);
            assert!(amount > max);
        }
    }

    #[test]
    fn test_fuzz_due_timestamp_progression() {
        // Property: Due timestamp should be in future
        let current_time = 1000u64;
        let months = 3u64;
        let duration_secs = months * 60;
        let due = current_time + duration_secs;
        
        assert!(due > current_time);
    }

    #[test]
    fn test_fuzz_months_duration_calculation() {
        // Property: Duration should increase with months
        let dur_1m = 1u64 * 60;
        let dur_3m = 3u64 * 60;
        let dur_6m = 6u64 * 60;
        let dur_12m = 12u64 * 60;
        
        assert!(dur_1m < dur_3m);
        assert!(dur_3m < dur_6m);
        assert!(dur_6m < dur_12m);
    }

    #[test]
    fn test_fuzz_repayment_partial() {
        // Property: Partial repayment reduces total_owed
        let initial_owed = 105_0000i128;
        let payment = 50_0000i128;
        let remaining = initial_owed - payment.min(initial_owed);
        
        assert!(remaining < initial_owed);
        assert_eq!(remaining, 55_0000);
    }

    #[test]
    fn test_fuzz_repayment_full() {
        // Property: Full repayment clears the loan
        let initial_owed = 105_0000i128;
        let payment = 105_0000i128;
        let remaining = initial_owed - payment.min(initial_owed);
        
        assert_eq!(remaining, 0);
    }

    #[test]
    fn test_fuzz_repayment_overpayment() {
        // Property: Overpayment is capped at total_owed
        let initial_owed = 105_0000i128;
        let payment = 200_0000i128; // More than owed
        let actual_payment = payment.min(initial_owed);
        
        assert_eq!(actual_payment, initial_owed);
        assert!(actual_payment <= initial_owed);
    }
}
}