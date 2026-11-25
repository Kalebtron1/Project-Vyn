#![cfg(test)]
extern crate std;

use crate::{Error, StakingContract, StakingContractClient};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Events},
    token, vec, Address, Env, Symbol, TryIntoVal, Val, Vec,
};

// ─── Mock vault DeFindex ───────────────────────────────────────────────────────
//
// Implementa la interfaz mínima que usa `staking_pool`. Mintea shares 1:1 con el
// monto depositado y simula la apreciación (rendimiento real) con un `rate` en
// basis points: `valor = shares * rate / 10000`. Por defecto 10000 (1.0x).

#[contracttype]
#[derive(Clone)]
enum VaultKey {
    Token,
    Rate,
    Shares(Address),
}

#[contract]
pub struct MockVault;

#[contractimpl]
impl MockVault {
    pub fn init(env: Env, token: Address) {
        env.storage().instance().set(&VaultKey::Token, &token);
        env.storage().instance().set(&VaultKey::Rate, &10_000i128);
    }

    /// Ajusta el factor de apreciación (bps) para simular yield acumulado.
    pub fn set_rate(env: Env, bps: i128) {
        env.storage().instance().set(&VaultKey::Rate, &bps);
    }

    fn rate(env: &Env) -> i128 {
        env.storage()
            .instance()
            .get(&VaultKey::Rate)
            .unwrap_or(10_000)
    }

    pub fn deposit(
        env: Env,
        amounts_desired: Vec<i128>,
        _amounts_min: Vec<i128>,
        from: Address,
        _invest: bool,
    ) -> i128 {
        from.require_auth();
        let amount = amounts_desired.get(0).unwrap_or(0);
        let token_addr: Address = env.storage().instance().get(&VaultKey::Token).unwrap();
        token::Client::new(&env, &token_addr).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );
        // Mintea shares 1:1 con el monto depositado.
        let key = VaultKey::Shares(from);
        let prev: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(prev + amount));
        amount
    }

    pub fn withdraw(
        env: Env,
        df_amount: i128,
        _min_amounts_out: Vec<i128>,
        from: Address,
    ) -> Vec<i128> {
        from.require_auth();
        let out = df_amount * Self::rate(&env) / 10_000;
        let key = VaultKey::Shares(from.clone());
        let prev: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(prev - df_amount));
        let token_addr: Address = env.storage().instance().get(&VaultKey::Token).unwrap();
        token::Client::new(&env, &token_addr).transfer(
            &env.current_contract_address(),
            &from,
            &out,
        );
        vec![&env, out]
    }

    pub fn get_asset_amounts_per_shares(env: Env, vault_shares: i128) -> Vec<i128> {
        vec![&env, vault_shares * Self::rate(&env) / 10_000]
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&VaultKey::Shares(id))
            .unwrap_or(0)
    }
}

// ─── Helpers de test ───────────────────────────────────────────────────────────

struct Setup {
    env: Env,
    staking: StakingContractClient<'static>,
    staking_addr: Address,
    admin: Address,
    token_addr: Address,
    token_admin: soroban_sdk::token::StellarAssetClient<'static>,
    vault_addr: Address,
    vault: MockVaultClient<'static>,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    // USDC simulado (Stellar Asset Contract).
    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let token_addr = sac.address();
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

    // Mock vault inicializado con ese token.
    let vault_addr = env.register(MockVault, ());
    let vault = MockVaultClient::new(&env, &vault_addr);
    vault.init(&token_addr);

    // Staking pool inicializado con admin + token + vault.
    let admin = Address::generate(&env);
    let staking_addr = env.register(StakingContract, ());
    let staking = StakingContractClient::new(&env, &staking_addr);
    staking.init(&admin, &token_addr, &vault_addr);

    Setup {
        env,
        staking,
        staking_addr,
        admin,
        token_addr,
        token_admin,
        vault_addr,
        vault,
    }
}

#[test]
fn test_init_rejects_reinit() {
    let s = setup();
    let res = s.staking.try_init(&s.admin, &s.token_addr, &s.vault_addr);
    assert_eq!(res, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_set_vault_migrates_vault() {
    let s = setup();
    assert_eq!(s.staking.get_vault(), s.vault_addr);

    // Despliega un segundo vault y migra hacia él (sin redeploy del staking).
    let new_vault_addr = s.env.register(MockVault, ());
    MockVaultClient::new(&s.env, &new_vault_addr).init(&s.token_addr);

    s.staking.set_vault(&new_vault_addr);
    assert_eq!(s.staking.get_vault(), new_vault_addr);
}

#[test]
fn test_set_vault_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let staking_addr = env.register(StakingContract, ());
    let staking = StakingContractClient::new(&env, &staking_addr);
    let some_vault = Address::generate(&env);
    let res = staking.try_set_vault(&some_vault);
    assert_eq!(res, Err(Ok(Error::NotInitialized)));
}

#[test]
fn test_deposit_records_shares_and_counters() {
    let s = setup();
    let user = Address::generate(&s.env);
    s.token_admin.mint(&user, &1_000);

    let minted = s.staking.deposit(&user, &1_000);
    assert_eq!(minted, 1_000); // 1:1 al rate por defecto

    assert_eq!(s.staking.get_shares(&user), 1_000);
    assert_eq!(s.staking.get_position(&user), 1_000);
    assert_eq!(s.staking.get_total_deposited(&user), 1_000);
    assert_eq!(s.staking.get_tx_count(&user), 1);
    // El token salió de la wallet del usuario hacia el vault.
    assert_eq!(token::Client::new(&s.env, &s.token_addr).balance(&user), 0);
}

#[test]
fn test_get_position_reflects_real_yield() {
    let s = setup();
    let user = Address::generate(&s.env);
    s.token_admin.mint(&user, &1_000);
    s.staking.deposit(&user, &1_000);

    // El vault aprecia 10%: la posición sube sin tocar las shares.
    s.vault.set_rate(&11_000);
    assert_eq!(s.staking.get_shares(&user), 1_000);
    assert_eq!(s.staking.get_position(&user), 1_100);
}

#[test]
fn test_partial_withdraw() {
    let s = setup();
    let user = Address::generate(&s.env);
    s.token_admin.mint(&user, &1_000);
    s.staking.deposit(&user, &1_000);

    let received = s.staking.withdraw(&user, &400);
    assert_eq!(received, 400);
    assert_eq!(s.staking.get_shares(&user), 600);
    assert_eq!(s.staking.get_position(&user), 600);
    assert_eq!(s.staking.get_total_withdrawn(&user), 400);
    assert_eq!(s.staking.get_tx_count(&user), 2); // 1 depósito + 1 retiro
    assert_eq!(
        token::Client::new(&s.env, &s.token_addr).balance(&user),
        400
    );
}

#[test]
fn test_full_withdraw_with_yield() {
    let s = setup();
    let user = Address::generate(&s.env);
    s.token_admin.mint(&user, &1_000);
    s.staking.deposit(&user, &1_000);

    // Fondea el vault para poder pagar el rendimiento y aprecia 10%.
    s.token_admin.mint(&s.vault_addr, &1_000);
    s.vault.set_rate(&11_000);

    // Pedir más que la posición retira todo (principal + yield).
    let received = s.staking.withdraw(&user, &10_000);
    assert_eq!(received, 1_100);
    assert_eq!(s.staking.get_shares(&user), 0);
    assert_eq!(s.staking.get_position(&user), 0);
    assert_eq!(
        token::Client::new(&s.env, &s.token_addr).balance(&user),
        1_100
    );
}

#[test]
fn test_deposit_invalid_amount() {
    let s = setup();
    let user = Address::generate(&s.env);
    let res = s.staking.try_deposit(&user, &0);
    assert_eq!(res, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_withdraw_without_position() {
    let s = setup();
    let user = Address::generate(&s.env);
    let res = s.staking.try_withdraw(&user, &100);
    assert_eq!(res, Err(Ok(Error::InsufficientPosition)));
}

#[test]
fn test_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let staking_addr = env.register(StakingContract, ());
    let staking = StakingContractClient::new(&env, &staking_addr);
    let user = Address::generate(&env);
    let res = staking.try_deposit(&user, &100);
    assert_eq!(res, Err(Ok(Error::NotInitialized)));
}

#[test]
fn test_get_position_zero_for_new_user() {
    let s = setup();
    let user = Address::generate(&s.env);
    assert_eq!(s.staking.get_position(&user), 0);
    assert_eq!(s.staking.get_shares(&user), 0);
}

// ─── Eventos ───────────────────────────────────────────────────────────────────

/// Devuelve (topics, data) del último evento con `action` publicado por el pool.
fn event_for(env: &Env, contract: &Address, action: &str) -> (Vec<Val>, Val) {
    let expected = Symbol::new(env, action);
    let all = env.events().all();
    for i in (0..all.len()).rev() {
        let (addr, topics, data) = all.get(i).unwrap();
        if &addr != contract || topics.len() < 2 {
            continue;
        }
        let topic0: Symbol = topics.get(0).unwrap().try_into_val(env).unwrap();
        if topic0 == expected {
            return (topics, data);
        }
    }
    panic!("event not found: {}", action);
}

fn address_topic(env: &Env, topics: &Vec<Val>, index: u32) -> Address {
    topics.get(index).unwrap().try_into_val(env).unwrap()
}

#[test]
fn test_init_emits_event() {
    let s = setup();
    let (topics, data) = event_for(&s.env, &s.staking_addr, "init");

    assert_eq!(address_topic(&s.env, &topics, 1), s.admin);
    let values: Vec<Val> = data.try_into_val(&s.env).unwrap();
    let token_addr: Address = values.get(0).unwrap().try_into_val(&s.env).unwrap();
    let vault_addr: Address = values.get(1).unwrap().try_into_val(&s.env).unwrap();
    assert_eq!(token_addr, s.token_addr);
    assert_eq!(vault_addr, s.vault_addr);
}

#[test]
fn test_set_vault_emits_event() {
    let s = setup();
    let new_vault_addr = s.env.register(MockVault, ());
    MockVaultClient::new(&s.env, &new_vault_addr).init(&s.token_addr);

    s.staking.set_vault(&new_vault_addr);

    let (topics, data) = event_for(&s.env, &s.staking_addr, "vault_set");
    assert_eq!(address_topic(&s.env, &topics, 1), s.admin);
    let vault_addr: Address = data.try_into_val(&s.env).unwrap();
    assert_eq!(vault_addr, new_vault_addr);
}

#[test]
fn test_deposit_emits_event() {
    let s = setup();
    let user = Address::generate(&s.env);
    s.token_admin.mint(&user, &1_000);

    s.staking.deposit(&user, &1_000);

    let (topics, data) = event_for(&s.env, &s.staking_addr, "deposit");
    assert_eq!(address_topic(&s.env, &topics, 1), user);
    let values: Vec<Val> = data.try_into_val(&s.env).unwrap();
    let amount: i128 = values.get(0).unwrap().try_into_val(&s.env).unwrap();
    let shares: i128 = values.get(1).unwrap().try_into_val(&s.env).unwrap();
    assert_eq!((amount, shares), (1_000, 1_000));
}

#[test]
fn test_withdraw_emits_event() {
    let s = setup();
    let user = Address::generate(&s.env);
    s.token_admin.mint(&user, &1_000);
    s.staking.deposit(&user, &1_000);

    s.staking.withdraw(&user, &400);

    let (topics, data) = event_for(&s.env, &s.staking_addr, "withdraw");
    assert_eq!(address_topic(&s.env, &topics, 1), user);
    let values: Vec<Val> = data.try_into_val(&s.env).unwrap();
    let amount: i128 = values.get(0).unwrap().try_into_val(&s.env).unwrap();
    let shares: i128 = values.get(1).unwrap().try_into_val(&s.env).unwrap();
    assert_eq!((amount, shares), (400, 400));
}
