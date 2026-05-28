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
        // OPT: pass &user directly — no clone needed before the storage key below
        client.transfer(&user, &env.current_contract_address(), &amount);

        let key = DataKey::Balance(user);
        let mut balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        balance += amount;
        env.storage().persistent().set(&key, &balance);
    }

    pub fn withdraw(env: Env, user: Address, amount: i128) {
        user.require_auth();
        assert!(amount > 0, "El monto debe ser mayor a 0");

        let key = DataKey::Balance(user.clone());
        let mut balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        assert!(balance >= amount, "Saldo disponible insuficiente");

        balance -= amount;
        env.storage().persistent().set(&key, &balance);

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let client = token::Client::new(&env, &token_addr);
        // OPT: &user is still valid — no second clone needed
        client.transfer(&env.current_contract_address(), &user, &amount);
    }

    pub fn stake(env: Env, user: Address, amount: i128, months: u64) {
        user.require_auth();
        assert!(amount > 0, "El monto debe ser mayor a 0");
        assert!(months == 1 || months == 3 || months == 6 || months == 12, "Plazo invalido");

        // OPT: build keys once, reuse — eliminates 6 redundant user.clone() calls
        let stake_key = DataKey::Stake(user.clone());
        let balance_key = DataKey::Balance(user);

        let stake_info: StakeInfo = env.storage().persistent().get(&stake_key).unwrap_or_default();
        assert!(stake_info.amount == 0, "Ya tienes un stake activo.");

        let mut balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);
        assert!(balance >= amount, "Saldo insuficiente para stakear");

        balance -= amount;
        env.storage().persistent().set(&balance_key, &balance);

        let apy = match months {
            1 => 4,
            3 => 7,
            6 => 11,
            12 => 18,
            _ => 17,
        };

        // MODO HACKATHON: 1 mes = 60 segundos
        let new_stake = StakeInfo {
            amount,
            unlock_time: env.ledger().timestamp() + months * 60,
            months,
            apy,
        };
        env.storage().persistent().set(&stake_key, &new_stake);
    }

    pub fn unstake(env: Env, user: Address) {
        user.require_auth();

        // OPT: build keys once — eliminates 4 redundant user.clone() calls
        let stake_key = DataKey::Stake(user.clone());
        let balance_key = DataKey::Balance(user);

        let stake_info: StakeInfo = env.storage().persistent().get(&stake_key).unwrap_or_default();
        assert!(stake_info.amount > 0, "No tienes fondos en stake");

        let current_time = env.ledger().timestamp();
        assert!(current_time >= stake_info.unlock_time, "El periodo de staking aun no termina");

        // Calculo de intereses: (Monto * APY * Meses) / 1200
        let interest = (stake_info.amount * (stake_info.apy as i128) * (stake_info.months as i128)) / 1200;
        let total_to_return = stake_info.amount + interest;

        // OPT: replace field-by-field zeroing with Default::default() — single host call
        env.storage().persistent().set(&stake_key, &StakeInfo::default());

        let mut balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);
        balance += total_to_return;
        env.storage().persistent().set(&balance_key, &balance);
    }

    pub fn get_balance(env: Env, user: Address) -> i128 {
        env.storage().persistent().get(&DataKey::Balance(user)).unwrap_or(0)
    }

    pub fn get_stake(env: Env, user: Address) -> (i128, u64, u64, u64) {
        let s: StakeInfo = env.storage().persistent().get(&DataKey::Stake(user)).unwrap_or_default();
        (s.amount, s.unlock_time, s.months, s.apy)
    }
}

// ─── Benchmark tests ─────────────────────────────────────────────────────────
// Run with: cargo test --features soroban-sdk/testutils -- --nocapture
//
// These tests print the CPU instructions and memory bytes consumed by each
// hot path using env.budget().print() so before/after numbers are comparable.
#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(admin.clone());
        let contract_id = env.register_contract(None, StakingContract);
        let client = StakingContractClient::new(&env, &contract_id);
        client.init(&token_id);

        let token = soroban_sdk::token::Client::new(&env, &token_id);
        let user = Address::generate(&env);
        token.mint(&user, &10_000);
        token.mint(&contract_id, &100_000); // pool liquidity for unstake interest
        client.deposit(&user, &5_000);
        (env, contract_id, user)
    }

    #[test]
    fn bench_stake() {
        let (env, contract_id, user) = setup();
        env.budget().reset_default();
        let client = StakingContractClient::new(&env, &contract_id);
        client.stake(&user, &1_000, &3);
        println!(
            "[bench_stake] cpu={} mem={}",
            env.budget().cpu_instruction_cost(),
            env.budget().memory_bytes_cost()
        );
    }

    #[test]
    fn bench_unstake() {
        let (env, contract_id, user) = setup();
        let client = StakingContractClient::new(&env, &contract_id);
        client.stake(&user, &1_000, &1);
        env.ledger().with_mut(|l| l.timestamp += 61);
        env.budget().reset_default();
        client.unstake(&user);
        println!(
            "[bench_unstake] cpu={} mem={}",
            env.budget().cpu_instruction_cost(),
            env.budget().memory_bytes_cost()
        );
    }
}
