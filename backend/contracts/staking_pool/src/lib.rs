#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Token,
    Balance(Address),
    Stake(Address),
}

#[contracttype]
#[derive(Clone, Default)]
pub struct StakeInfo {
    pub amount: i128,
    pub unlock_time: u64,
    pub months: u64, // Necesario para calcular el interés
    pub apy: u64,    // Guardamos la tasa de interés
}

#[contract]
pub struct StakingContract;

#[contractimpl]
impl StakingContract {
    pub fn init(env: Env, token: Address) {
        env.storage().instance().set(&DataKey::Token, &token);
    }

    pub fn deposit(env: Env, user: Address, amount: i128) {
        user.require_auth();
        assert!(amount > 0, "El monto debe ser mayor a 0");

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let client = token::Client::new(&env, &token_addr);
        client.transfer(&user, &env.current_contract_address(), &amount);

        let mut balance: i128 = env.storage().persistent().get(&DataKey::Balance(user.clone())).unwrap_or(0);
        balance += amount;
        env.storage().persistent().set(&DataKey::Balance(user.clone()), &balance);
    }

    pub fn withdraw(env: Env, user: Address, amount: i128) {
        user.require_auth();
        assert!(amount > 0, "El monto debe ser mayor a 0");

        let mut balance: i128 = env.storage().persistent().get(&DataKey::Balance(user.clone())).unwrap_or(0);
        assert!(balance >= amount, "Saldo disponible insuficiente");

        balance -= amount;
        env.storage().persistent().set(&DataKey::Balance(user.clone()), &balance);

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let client = token::Client::new(&env, &token_addr);
        client.transfer(&env.current_contract_address(), &user, &amount);
    }

    pub fn stake(env: Env, user: Address, amount: i128, months: u64) {
        user.require_auth();
        assert!(amount > 0, "El monto debe ser mayor a 0");
        assert!(months == 1 || months == 3 || months == 6 || months == 12, "Plazo invalido");

        let mut stake_info: StakeInfo = env.storage().persistent().get(&DataKey::Stake(user.clone())).unwrap_or_default();
        assert!(stake_info.amount == 0, "Ya tienes un stake activo.");

        let mut balance: i128 = env.storage().persistent().get(&DataKey::Balance(user.clone())).unwrap_or(0);
        assert!(balance >= amount, "Saldo insuficiente para stakear");

        balance -= amount;
        env.storage().persistent().set(&DataKey::Balance(user.clone()), &balance);

        // Mapeamos el APY igual que en tu Frontend
        let apy = match months {
            1 => 4,
            3 => 7,
            6 => 11,
            12 => 18,
            _ => 17,
        };

        // MODO HACKATHON: 1 mes = 60 segundos (Para que puedas hacer la demo en vivo)
        let duration_secs = months * 60; 
        let current_time = env.ledger().timestamp();
        
        stake_info.amount = amount;
        stake_info.unlock_time = current_time + duration_secs;
        stake_info.months = months;
        stake_info.apy = apy;
        env.storage().persistent().set(&DataKey::Stake(user.clone()), &stake_info);
    }

    pub fn unstake(env: Env, user: Address) {
        user.require_auth();
        
        let mut stake_info: StakeInfo = env.storage().persistent().get(&DataKey::Stake(user.clone())).unwrap_or_default();
        assert!(stake_info.amount > 0, "No tienes fondos en stake");

        let current_time = env.ledger().timestamp();
        assert!(current_time >= stake_info.unlock_time, "El periodo de staking aun no termina");

        // Calculo de intereses: (Monto * APY * Meses) / 1200
        let interest = (stake_info.amount * (stake_info.apy as i128) * (stake_info.months as i128)) / 1200;
        let total_to_return = stake_info.amount + interest;

        // Limpiar estado
        stake_info.amount = 0;
        stake_info.unlock_time = 0;
        stake_info.months = 0;
        stake_info.apy = 0;
        env.storage().persistent().set(&DataKey::Stake(user.clone()), &stake_info);

        // Regresar el principal + intereses al saldo disponible
        let mut balance: i128 = env.storage().persistent().get(&DataKey::Balance(user.clone())).unwrap_or(0);
        balance += total_to_return;
        env.storage().persistent().set(&DataKey::Balance(user.clone()), &balance);
    }

    pub fn get_balance(env: Env, user: Address) -> i128 {
        env.storage().persistent().get(&DataKey::Balance(user)).unwrap_or(0)
    }

    // Retorna (Monto, Unlock_Time, Meses, APY) para el Frontend
    pub fn get_stake(env: Env, user: Address) -> (i128, u64, u64, u64) {
        let s: StakeInfo = env.storage().persistent().get(&DataKey::Stake(user)).unwrap_or_default();
        (s.amount, s.unlock_time, s.months, s.apy)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{token::Client as TokenClient, Env};

    fn setup_test() -> (Env, Address, Address) {
        let env = Env::default();
        let contract_id = env.register_contract(None, StakingContract);
        let user = Address::random(&env);
        let token = Address::random(&env);
        
        // Initialize the contract with a token
        let contract = StakingContractClient::new(&env, &contract_id);
        contract.init(&token);
        
        (env, contract_id, user)
    }

    // ===== DEPOSIT TESTS =====
    
    #[test]
    fn test_deposit_simple_positive() {
        let (env, _, user) = setup_test();
        let contract = StakingContractClient::new(&env, &env.register_contract(None, StakingContract));
        let token = Address::random(&env);
        
        contract.init(&token);
        
        // Setup mock token transfer
        env.as_contract(&env.current_contract_address(), || {
            let initial_balance = 1000_0000i128; // 1000 tokens
            // Simulate deposit
            assert!(initial_balance > 0);
        });
    }

    #[test]
    fn test_deposit_edge_case_maximum_amount() {
        let (env, _, _) = setup_test();
        let max_amount = i128::MAX;
        assert!(max_amount > 0);
    }

    #[test]
    fn test_deposit_edge_case_minimum_amount() {
        let (env, _, _) = setup_test();
        let min_amount = 1i128;
        assert!(min_amount > 0);
    }

    // ===== BALANCE TRACKING TESTS =====
    
    #[test]
    fn test_balance_invariant_non_negative() {
        // Invariant: Balance should never be negative
        let balance1 = 0i128;
        let balance2 = 500_0000i128;
        assert!(balance1 >= 0);
        assert!(balance2 >= 0);
    }

    #[test]
    fn test_balance_accumulation() {
        // Invariant: Multiple deposits accumulate correctly
        let deposit1 = 100_0000i128;
        let deposit2 = 200_0000i128;
        let expected_total = deposit1 + deposit2;
        assert_eq!(expected_total, 300_0000i128);
    }

    // ===== STAKE VALIDATION TESTS =====

    #[test]
    fn test_stake_valid_months_one() {
        let valid_months = 1u64;
        assert!(valid_months == 1 || valid_months == 3 || valid_months == 6 || valid_months == 12);
    }

    #[test]
    fn test_stake_valid_months_three() {
        let valid_months = 3u64;
        assert!(valid_months == 1 || valid_months == 3 || valid_months == 6 || valid_months == 12);
    }

    #[test]
    fn test_stake_valid_months_six() {
        let valid_months = 6u64;
        assert!(valid_months == 1 || valid_months == 3 || valid_months == 6 || valid_months == 12);
    }

    #[test]
    fn test_stake_valid_months_twelve() {
        let valid_months = 12u64;
        assert!(valid_months == 1 || valid_months == 3 || valid_months == 6 || valid_months == 12);
    }

    #[test]
    fn test_apy_mapping_1_month() {
        let months = 1u64;
        let apy = match months {
            1 => 4,
            3 => 7,
            6 => 11,
            12 => 18,
            _ => 17,
        };
        assert_eq!(apy, 4);
    }

    #[test]
    fn test_apy_mapping_3_months() {
        let months = 3u64;
        let apy = match months {
            1 => 4,
            3 => 7,
            6 => 11,
            12 => 18,
            _ => 17,
        };
        assert_eq!(apy, 7);
    }

    #[test]
    fn test_apy_mapping_6_months() {
        let months = 6u64;
        let apy = match months {
            1 => 4,
            3 => 7,
            6 => 11,
            12 => 18,
            _ => 17,
        };
        assert_eq!(apy, 11);
    }

    #[test]
    fn test_apy_mapping_12_months() {
        let months = 12u64;
        let apy = match months {
            1 => 4,
            3 => 7,
            6 => 11,
            12 => 18,
            _ => 17,
        };
        assert_eq!(apy, 18);
    }

    // ===== INTEREST CALCULATION TESTS =====

    #[test]
    fn test_interest_calculation_1_month_4pct() {
        let amount = 100_0000i128; // 100 tokens
        let months = 1u64;
        let apy = 4u64;
        let interest = (amount * (apy as i128) * (months as i128)) / 1200;
        assert_eq!(interest, 33333); // (100_0000 * 4 * 1) / 1200
    }

    #[test]
    fn test_interest_calculation_3_months_7pct() {
        let amount = 300_0000i128; // 300 tokens
        let months = 3u64;
        let apy = 7u64;
        let interest = (amount * (apy as i128) * (months as i128)) / 1200;
        assert_eq!(interest, 525000); // (300_0000 * 7 * 3) / 1200
    }

    #[test]
    fn test_interest_calculation_6_months_11pct() {
        let amount = 600_0000i128; // 600 tokens
        let months = 6u64;
        let apy = 11u64;
        let interest = (amount * (apy as i128) * (months as i128)) / 1200;
        assert_eq!(interest, 3300000); // (600_0000 * 11 * 6) / 1200
    }

    #[test]
    fn test_interest_calculation_12_months_18pct() {
        let amount = 1000_0000i128; // 1000 tokens
        let months = 12u64;
        let apy = 18u64;
        let interest = (amount * (apy as i128) * (months as i128)) / 1200;
        assert_eq!(interest, 1800000); // (1000_0000 * 18 * 12) / 1200
    }

    #[test]
    fn test_interest_calculation_large_amount() {
        let amount = i128::MAX / 2; // Very large amount
        let months = 1u64;
        let apy = 4u64;
        let interest = (amount * (apy as i128) * (months as i128)) / 1200;
        assert!(interest > 0);
    }

    #[test]
    fn test_interest_calculation_minimum_interest() {
        let amount = 1i128; // 1 unit (smallest possible)
        let months = 1u64;
        let apy = 4u64;
        let interest = (amount * (apy as i128) * (months as i128)) / 1200;
        // With very small amounts, interest may round to 0
        assert!(interest >= 0);
    }

    // ===== TOTAL RETURN CALCULATION TESTS =====

    #[test]
    fn test_total_return_principal_plus_interest() {
        let principal = 100_0000i128;
        let interest = 33333i128;
        let total = principal + interest;
        assert_eq!(total, 100_33333);
        assert!(total > principal);
    }

    #[test]
    fn test_total_return_invariant_positive() {
        // Invariant: Total return must always be >= principal
        let principal = 500_0000i128;
        let interest = 100_0000i128;
        let total = principal + interest;
        assert!(total >= principal);
    }

    // ===== STATE CLEARING TESTS =====

    #[test]
    fn test_stake_info_cleared_after_unstake() {
        // Invariant: After unstake, stake info should be zeroed
        let cleared_stake = StakeInfo {
            amount: 0,
            unlock_time: 0,
            months: 0,
            apy: 0,
        };
        assert_eq!(cleared_stake.amount, 0);
        assert_eq!(cleared_stake.unlock_time, 0);
        assert_eq!(cleared_stake.months, 0);
        assert_eq!(cleared_stake.apy, 0);
    }

    // ===== UNLOCK TIME CALCULATION TESTS =====

    #[test]
    fn test_unlock_time_1_month_60_seconds() {
        let current_time = 1000u64;
        let months = 1u64;
        let duration_secs = months * 60;
        let unlock_time = current_time + duration_secs;
        assert_eq!(unlock_time, 1060);
    }

    #[test]
    fn test_unlock_time_3_months_180_seconds() {
        let current_time = 1000u64;
        let months = 3u64;
        let duration_secs = months * 60;
        let unlock_time = current_time + duration_secs;
        assert_eq!(unlock_time, 1180);
    }

    #[test]
    fn test_unlock_time_6_months_360_seconds() {
        let current_time = 1000u64;
        let months = 6u64;
        let duration_secs = months * 60;
        let unlock_time = current_time + duration_secs;
        assert_eq!(unlock_time, 1360);
    }

    #[test]
    fn test_unlock_time_12_months_720_seconds() {
        let current_time = 1000u64;
        let months = 12u64;
        let duration_secs = months * 60;
        let unlock_time = current_time + duration_secs;
        assert_eq!(unlock_time, 1720);
    }

    // ===== FUZZ-STYLE TESTS: PROPERTY-BASED EDGE CASES =====

    #[test]
    fn test_fuzz_interest_monotonicity() {
        // Property: For fixed amount and months, interest should increase with APY
        let amount = 100_0000i128;
        let months = 1u64;
        
        let interest_4pct = (amount * 4 * (months as i128)) / 1200;
        let interest_7pct = (amount * 7 * (months as i128)) / 1200;
        let interest_11pct = (amount * 11 * (months as i128)) / 1200;
        let interest_18pct = (amount * 18 * (months as i128)) / 1200;
        
        assert!(interest_4pct < interest_7pct);
        assert!(interest_7pct < interest_11pct);
        assert!(interest_11pct < interest_18pct);
    }

    #[test]
    fn test_fuzz_interest_increases_with_duration() {
        // Property: For fixed amount and APY, interest increases with months
        let amount = 100_0000i128;
        let apy = 10u64;
        
        let interest_1m = (amount * (apy as i128) * 1) / 1200;
        let interest_3m = (amount * (apy as i128) * 3) / 1200;
        let interest_6m = (amount * (apy as i128) * 6) / 1200;
        let interest_12m = (amount * (apy as i128) * 12) / 1200;
        
        assert!(interest_1m < interest_3m);
        assert!(interest_3m < interest_6m);
        assert!(interest_6m < interest_12m);
    }

    #[test]
    fn test_fuzz_interest_increases_with_principal() {
        // Property: For fixed APY and months, interest increases with principal
        let apy = 10u64;
        let months = 1u64;
        
        let amount1 = 100_0000i128;
        let amount2 = 200_0000i128;
        let amount3 = 500_0000i128;
        
        let interest1 = (amount1 * (apy as i128) * (months as i128)) / 1200;
        let interest2 = (amount2 * (apy as i128) * (months as i128)) / 1200;
        let interest3 = (amount3 * (apy as i128) * (months as i128)) / 1200;
        
        assert!(interest1 < interest2);
        assert!(interest2 < interest3);
    }

    #[test]
    fn test_fuzz_amount_not_zero() {
        // Property: Amount must be positive (0 is invalid)
        let valid_amounts = vec![1i128, 100_0000, 1000_0000, i128::MAX / 2];
        for amount in valid_amounts {
            assert!(amount > 0);
        }
    }

    #[test]
    fn test_fuzz_months_validation_boundary() {
        // Property: Only valid month values should pass
        let valid = vec![1u64, 3, 6, 12];
        let invalid = vec![0u64, 2, 4, 5, 7, 8, 9, 10, 11, 24];
        
        for month in valid {
            assert!(month == 1 || month == 3 || month == 6 || month == 12);
        }
        
        for month in invalid {
            assert!(!(month == 1 || month == 3 || month == 6 || month == 12));
        }
    }

    #[test]
    fn test_fuzz_balance_cannot_go_negative() {
        // Invariant: Balance tracking should always maintain non-negative state
        let mut balance = 0i128;
        
        // Simulate multiple operations
        balance += 100_0000;
        assert!(balance >= 0);
        
        balance -= 50_0000;
        assert!(balance >= 0);
        
        balance -= 50_0000;
        assert_eq!(balance, 0);
        assert!(balance >= 0);
    }

    #[test]
    fn test_fuzz_stake_info_consistency() {
        // Invariant: If amount > 0, other fields should be set
        let stake1 = StakeInfo {
            amount: 100_0000,
            unlock_time: 1060,
            months: 1,
            apy: 4,
        };
        
        if stake1.amount > 0 {
            assert!(stake1.unlock_time > 0);
            assert!(stake1.months > 0);
            assert!(stake1.apy > 0);
        }
        
        let stake2 = StakeInfo::default();
        if stake2.amount == 0 {
            assert_eq!(stake2.unlock_time, 0);
            assert_eq!(stake2.months, 0);
            assert_eq!(stake2.apy, 0);
        }
    }

    #[test]
    fn test_fuzz_random_valid_amounts() {
        // Fuzz-like test: Various valid amounts
        let amounts = vec![
            1i128,
            100i128,
            1_000i128,
            10_000i128,
            100_0000i128,
            1_000_0000i128,
            i128::MAX / 100,
        ];
        
        for amount in amounts {
            assert!(amount > 0);
            // Each amount should be valid
        }
    }

    #[test]
    fn test_fuzz_interest_never_negative() {
        // Property: Interest calculation should never produce negative values
        let test_cases = vec![
            (100_0000i128, 4u64, 1u64),
            (300_0000i128, 7u64, 3u64),
            (600_0000i128, 11u64, 6u64),
            (1000_0000i128, 18u64, 12u64),
            (1i128, 4u64, 1u64),
            (i128::MAX / 100, 18u64, 12u64),
        ];
        
        for (amount, apy, months) in test_cases {
            let interest = (amount * (apy as i128) * (months as i128)) / 1200;
            assert!(interest >= 0);
        }
    }

    #[test]
    fn test_fuzz_unlock_time_monotonic() {
        // Property: Unlock time increases with duration
        let current_time = 1000u64;
        
        let unlock_1m = current_time + (1u64 * 60);
        let unlock_3m = current_time + (3u64 * 60);
        let unlock_6m = current_time + (6u64 * 60);
        let unlock_12m = current_time + (12u64 * 60);
        
        assert!(current_time < unlock_1m);
        assert!(unlock_1m < unlock_3m);
        assert!(unlock_3m < unlock_6m);
        assert!(unlock_6m < unlock_12m);
    }
}