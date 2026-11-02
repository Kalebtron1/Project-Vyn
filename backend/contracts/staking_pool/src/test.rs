#![cfg(test)]
extern crate std;

use crate::{DataKey, Error, StakingContract, StakingContractClient, TTL_EXTEND_TO};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{storage::Instance as _, storage::Persistent as _, Address as _},
    token, vec, Address, Env, Vec,
};

const WASM: &[u8] = include_bytes!("../../target/wasm32v1-none/release/staking_pool.wasm");

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
            env.current_contract_address(),
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
    id: Address,
    admin: Address,
    pauser: Address,
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

    // Staking pool creado con admin + pauser + token + vault.
    let admin = Address::generate(&env);
    let pauser = Address::generate(&env);
    let id = env.register(
        StakingContract,
        (
            admin.clone(),
            pauser.clone(),
            token_addr.clone(),
            vault_addr.clone(),
        ),
    );
    let staking = StakingContractClient::new(&env, &id);

    Setup {
        env,
        staking,
        id,
        admin,
        pauser,
        token_addr,
        token_admin,
        vault_addr,
        vault,
    }
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
fn test_set_vault_needs_admin() {
    let s = setup();
    let other = Address::generate(&s.env);
    s.env.set_auths(&[]);
    assert!(s.staking.try_set_vault(&other).is_err());
    assert_eq!(s.staking.get_vault(), s.vault_addr);
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
fn test_get_position_zero_for_new_user() {
    let s = setup();
    let user = Address::generate(&s.env);
    assert_eq!(s.staking.get_position(&user), 0);
    assert_eq!(s.staking.get_shares(&user), 0);
}

#[test]
fn test_deposit_and_withdraw_need_user_signature() {
    let s = setup();
    let user = Address::generate(&s.env);
    s.token_admin.mint(&user, &1_000);
    s.staking.deposit(&user, &500);

    s.env.set_auths(&[]);
    assert!(s.staking.try_deposit(&user, &100).is_err());
    assert!(s.staking.try_withdraw(&user, &100).is_err());
    assert_eq!(s.staking.get_shares(&user), 500);
}

#[test]
fn test_only_pauser_pauses_and_only_admin_unpauses() {
    let s = setup();
    let stranger = Address::generate(&s.env);
    assert!(s.staking.try_pause(&stranger).is_err());
    assert!(s.staking.try_pause(&s.admin).is_err());

    s.staking.pause(&s.pauser);
    assert!(s.staking.paused());

    s.env.set_auths(&[]);
    assert!(s.staking.try_unpause(&s.pauser).is_err());
    assert!(s.staking.paused());

    s.env.mock_all_auths_allowing_non_root_auth();
    s.staking.unpause(&s.admin);
    assert!(!s.staking.paused());
}

#[test]
fn test_pause_blocks_deposit_but_never_withdraw() {
    let s = setup();
    let user = Address::generate(&s.env);
    s.token_admin.mint(&user, &1_000);
    s.staking.deposit(&user, &600);

    s.staking.pause(&s.pauser);
    assert!(s.staking.try_deposit(&user, &100).is_err());
    assert_eq!(s.staking.withdraw(&user, &600), 600);
    assert_eq!(s.staking.get_shares(&user), 0);
}

#[test]
fn test_writes_extend_ttl() {
    let s = setup();
    let user = Address::generate(&s.env);
    s.token_admin.mint(&user, &1_000);
    s.staking.deposit(&user, &1_000);
    s.env.as_contract(&s.id, || {
        let storage = s.env.storage();
        for key in [
            DataKey::Shares(user.clone()),
            DataKey::TotalDeposited(user.clone()),
            DataKey::TxCount(user.clone()),
        ] {
            assert_eq!(storage.persistent().get_ttl(&key), TTL_EXTEND_TO);
        }
        assert_eq!(storage.instance().get_ttl(), TTL_EXTEND_TO);
    });
}

#[test]
fn test_upgrade_requires_admin_and_keeps_state() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let vault = Address::generate(&env);
    let id = env.register(WASM, (admin.clone(), admin.clone(), token, vault.clone()));
    let client = StakingContractClient::new(&env, &id);
    let hash = env.deployer().upload_contract_wasm(WASM);

    env.set_auths(&[]);
    assert!(client.try_upgrade(&hash, &vault).is_err());

    env.mock_all_auths();
    client.upgrade(&hash, &admin);
    assert_eq!(client.get_vault(), vault);
    assert_eq!(client.get_admin(), Some(admin.clone()));
    client.upgrade(&hash, &admin);
}
