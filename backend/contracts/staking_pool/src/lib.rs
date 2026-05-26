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
        // SECURITY-FIX [RISK-04]: guard against re-initialization; once set, token address is immutable
        if env.storage().instance().has(&DataKey::Token) {
            panic!("already initialized");
        }
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