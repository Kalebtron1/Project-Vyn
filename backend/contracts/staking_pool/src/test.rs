#![cfg(test)]
extern crate std;

use crate::{
    DataKey, Error, StakingContract, StakingContractClient, VaultAsset, TTL_EXTEND_TO,
    VIRTUAL_SHARES,
};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{storage::Instance as _, storage::Persistent as _, Address as _, Ledger as _},
    token, vec, Address, Env, Symbol, Vec,
};

const WASM: &[u8] = include_bytes!("../../target/wasm32v1-none/release/staking_pool.wasm");
const MIN_COUNTED: i128 = 100;

// ─── Mock vault DeFindex ───────────────────────────────────────────────────────
//
// Implementa la interfaz mínima que usa `staking_pool`. Simula la apreciación con
// un `rate` en basis points: `valor = shares * rate / 10000`. Como el vault real,
// mintea shares proporcionales al precio vigente.

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
    pub fn __constructor(env: Env, token: Address) {
        env.storage().instance().set(&VaultKey::Token, &token);
        env.storage().instance().set(&VaultKey::Rate, &10_000i128);
    }

    /// Ajusta el factor de apreciación (bps) para simular yield acumulado o pérdida.
    pub fn set_rate(env: Env, bps: i128) {
        env.storage().instance().set(&VaultKey::Rate, &bps);
    }

    /// Da dfTokens sin depositar, como quien los transfiere directo al pool.
    pub fn donate(env: Env, to: Address, shares: i128) {
        let key = VaultKey::Shares(to);
        let prev: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(prev + shares));
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
        let minted = amount * 10_000 / Self::rate(&env);
        let key = VaultKey::Shares(from);
        let prev: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(prev + minted));
        minted
    }

    pub fn withdraw(
        env: Env,
        df_amount: i128,
        min_amounts_out: Vec<i128>,
        from: Address,
    ) -> Vec<i128> {
        from.require_auth();
        let out = df_amount * Self::rate(&env) / 10_000;
        assert!(out >= min_amounts_out.get(0).unwrap_or(0), "vault slippage");
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

    pub fn get_assets(env: Env) -> Vec<VaultAsset> {
        let token: Address = env.storage().instance().get(&VaultKey::Token).unwrap();
        vec![
            &env,
            VaultAsset {
                address: token,
                strategies: vec![&env],
            },
        ]
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
    lending: Address,
    token_addr: Address,
    token_admin: soroban_sdk::token::StellarAssetClient<'static>,
    vault_addr: Address,
    vault: MockVaultClient<'static>,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().set_timestamp(1_000);

    // USDC simulado (Stellar Asset Contract).
    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let token_addr = sac.address();
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

    let vault_addr = env.register(MockVault, (token_addr.clone(),));
    let vault = MockVaultClient::new(&env, &vault_addr);

    let admin = Address::generate(&env);
    let pauser = Address::generate(&env);
    let id = env.register(
        StakingContract,
        (
            admin.clone(),
            pauser.clone(),
            token_addr.clone(),
            vault_addr.clone(),
            MIN_COUNTED,
        ),
    );
    let staking = StakingContractClient::new(&env, &id);

    let lending = Address::generate(&env);
    staking.grant_role(&lending, &Symbol::new(&env, "lending"), &admin);

    Setup {
        env,
        staking,
        id,
        admin,
        pauser,
        lending,
        token_addr,
        token_admin,
        vault_addr,
        vault,
    }
}

impl Setup {
    fn user_with_deposit(&self, amount: i128) -> Address {
        let user = Address::generate(&self.env);
        self.token_admin.mint(&user, &amount);
        self.staking.deposit(&user, &amount);
        user
    }

    fn balance(&self, who: &Address) -> i128 {
        token::Client::new(&self.env, &self.token_addr).balance(who)
    }
}

// ─── Constructor y vault ───────────────────────────────────────────────────────

#[test]
#[should_panic]
fn test_constructor_rejects_vault_of_other_token() {
    let s = setup();
    let other_issuer = Address::generate(&s.env);
    let other = s
        .env
        .register_stellar_asset_contract_v2(other_issuer)
        .address();
    s.env.register(
        StakingContract,
        (
            s.admin.clone(),
            s.pauser.clone(),
            other,
            s.vault_addr.clone(),
            MIN_COUNTED,
        ),
    );
}

#[test]
fn test_migrate_vault_moves_funds_and_keeps_positions() {
    let s = setup();
    let user = s.user_with_deposit(1_000);
    let shares = s.staking.get_shares(&user);

    let new_vault = s.env.register(MockVault, (s.token_addr.clone(),));
    assert_eq!(s.staking.migrate_vault(&new_vault, &1_000), 1_000);

    assert_eq!(s.staking.get_vault(), new_vault);
    assert_eq!(s.staking.get_shares(&user), shares);
    assert_eq!(s.staking.get_position(&user), 1_000);
    assert_eq!(s.vault.balance(&s.id), 0);
    assert_eq!(s.balance(&s.vault_addr), 0);
    assert_eq!(s.balance(&new_vault), 1_000);
    assert_eq!(s.staking.withdraw(&user, &1_000, &1_000), 1_000);
}

#[test]
fn test_migrate_vault_rejects_loss_wrong_token_and_non_admin() {
    let s = setup();
    s.user_with_deposit(1_000);
    let new_vault = s.env.register(MockVault, (s.token_addr.clone(),));

    assert_eq!(
        s.staking.try_migrate_vault(&new_vault, &1_001),
        Err(Ok(Error::MigrationLoss))
    );
    assert_eq!(s.staking.get_vault(), s.vault_addr);
    assert_eq!(
        s.staking.try_migrate_vault(&s.vault_addr, &0),
        Err(Ok(Error::InvalidVault))
    );

    let other_issuer = Address::generate(&s.env);
    let other = s
        .env
        .register_stellar_asset_contract_v2(other_issuer)
        .address();
    let other_vault = s.env.register(MockVault, (other,));
    assert_eq!(
        s.staking.try_migrate_vault(&other_vault, &0),
        Err(Ok(Error::InvalidVault))
    );

    s.env.set_auths(&[]);
    assert!(s.staking.try_migrate_vault(&new_vault, &0).is_err());
    assert_eq!(s.staking.get_vault(), s.vault_addr);
}

// ─── Depósitos y retiros ───────────────────────────────────────────────────────

#[test]
fn test_deposit_records_shares_and_stats() {
    let s = setup();
    let user = Address::generate(&s.env);
    s.token_admin.mint(&user, &1_000);

    let minted = s.staking.deposit(&user, &1_000);
    assert_eq!(minted, 1_000 * VIRTUAL_SHARES);

    assert_eq!(s.staking.get_shares(&user), minted);
    assert_eq!(s.staking.get_total_shares(), minted);
    assert_eq!(s.staking.get_position(&user), 1_000);
    assert_eq!(s.staking.get_total_deposited(&user), 1_000);
    assert_eq!(s.staking.get_tx_count(&user), 1);
    assert_eq!(s.balance(&user), 0);
}

#[test]
fn test_get_position_reflects_real_yield() {
    let s = setup();
    let user = s.user_with_deposit(1_000);
    s.vault.set_rate(&11_000);
    assert_eq!(s.staking.get_position(&user), 1_100);
}

#[test]
fn test_late_depositor_does_not_take_earlier_yield() {
    let s = setup();
    let early = s.user_with_deposit(1_000_000);
    s.token_admin.mint(&s.vault_addr, &1_000_000);
    s.vault.set_rate(&11_000);

    let late = s.user_with_deposit(1_100_000);
    assert!(s.staking.get_position(&early) >= 1_099_999);
    assert!(s.staking.get_position(&late) >= 1_099_999);
}

#[test]
fn test_partial_withdraw() {
    let s = setup();
    let user = s.user_with_deposit(1_000);

    let received = s.staking.withdraw(&user, &400, &400);
    assert_eq!(received, 400);
    assert_eq!(s.staking.get_position(&user), 600);
    assert_eq!(s.staking.get_total_withdrawn(&user), 400);
    assert_eq!(s.staking.get_tx_count(&user), 2);
    assert_eq!(s.balance(&user), 400);
}

#[test]
fn test_full_withdraw_with_yield() {
    let s = setup();
    let user = s.user_with_deposit(1_000);
    s.token_admin.mint(&s.vault_addr, &1_000);
    s.vault.set_rate(&11_000);

    // Pedir más que la posición retira todo (principal + yield).
    let received = s.staking.withdraw(&user, &10_000, &1_100);
    assert_eq!(received, 1_100);
    assert_eq!(s.staking.get_shares(&user), 0);
    assert_eq!(s.staking.get_position(&user), 0);
    assert_eq!(s.staking.get_total_shares(), 0);
    assert_eq!(s.balance(&user), 1_100);
}

#[test]
fn test_pool_can_refill_after_being_emptied() {
    let s = setup();
    let first = s.user_with_deposit(1_000);
    s.staking.withdraw(&first, &1_000, &0);
    assert_eq!(s.staking.get_total_shares(), 0);

    let second = s.user_with_deposit(500);
    assert_eq!(s.staking.get_position(&second), 500);
}

#[test]
fn test_withdraw_reverts_below_min_out() {
    let s = setup();
    let user = s.user_with_deposit(1_000);
    s.vault.set_rate(&9_000);
    assert!(s.staking.try_withdraw(&user, &1_000, &1_000).is_err());
    assert_eq!(s.staking.get_position(&user), 900);
    assert_eq!(s.balance(&user), 0);
}

#[test]
fn test_withdraw_to_pays_other_account_with_user_signature() {
    let s = setup();
    let user = s.user_with_deposit(1_000);
    let payout = Address::generate(&s.env);

    s.env.set_auths(&[]);
    assert!(s
        .staking
        .try_withdraw_to(&user, &300, &300, &payout)
        .is_err());

    s.env.mock_all_auths_allowing_non_root_auth();
    assert_eq!(s.staking.withdraw_to(&user, &300, &300, &payout), 300);
    assert_eq!(s.balance(&payout), 300);
    assert_eq!(s.balance(&user), 0);
}

#[test]
fn test_invalid_amounts() {
    let s = setup();
    let user = s.user_with_deposit(1_000);
    assert_eq!(
        s.staking.try_deposit(&user, &0),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        s.staking.try_withdraw(&user, &0, &0),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        s.staking.try_withdraw(&user, &1, &-1),
        Err(Ok(Error::InvalidAmount))
    );
}

#[test]
fn test_withdraw_without_position() {
    let s = setup();
    let user = Address::generate(&s.env);
    assert_eq!(
        s.staking.try_withdraw(&user, &100, &0),
        Err(Ok(Error::InsufficientPosition))
    );
}

#[test]
fn test_deposit_too_small_for_one_share_is_rejected() {
    let s = setup();
    s.user_with_deposit(1_000);
    // El vault vale 1,000 veces más que lo que entra: el mock mintea 0 dfTokens.
    s.vault.set_rate(&100_000_000);
    let user = Address::generate(&s.env);
    s.token_admin.mint(&user, &1);
    assert!(s.staking.try_deposit(&user, &1).is_err());
    assert_eq!(s.balance(&user), 1);
}

#[test]
fn test_inflation_attack_does_not_profit() {
    let s = setup();
    let attacker = s.user_with_deposit(1);
    let donation = 10_000_000;
    s.token_admin.mint(&s.vault_addr, &donation);
    s.vault.donate(&s.id, &donation);

    let victim = s.user_with_deposit(donation);
    assert!(s.staking.get_shares(&victim) > 0);

    let attacker_gets = s.staking.get_position(&attacker);
    assert!(
        attacker_gets < donation + 1,
        "el atacante recupera {attacker_gets} de {} invertidos",
        donation + 1
    );
    assert!(s.staking.get_position(&victim) >= donation);
}

#[test]
fn test_rounding_never_pays_more_than_the_pool_has() {
    let s = setup();
    let users = [
        s.user_with_deposit(1),
        s.user_with_deposit(333),
        s.user_with_deposit(7_777),
    ];
    s.token_admin.mint(&s.vault_addr, &1_000);
    s.vault.set_rate(&10_333);
    let backing = s.balance(&s.vault_addr);

    let mut paid = 0;
    for user in users.iter() {
        paid += s.staking.withdraw(user, &i128::MAX, &0);
    }
    assert!(paid <= backing);
    assert_eq!(s.staking.get_total_shares(), 0);
    assert_eq!(s.vault.balance(&s.id), 0);
}

#[test]
fn test_deposit_and_withdraw_need_user_signature() {
    let s = setup();
    let user = s.user_with_deposit(500);
    s.token_admin.mint(&user, &500);

    s.env.set_auths(&[]);
    assert!(s.staking.try_deposit(&user, &100).is_err());
    assert!(s.staking.try_withdraw(&user, &100, &0).is_err());
    assert_eq!(s.staking.get_position(&user), 500);
}

// ─── Colateral ─────────────────────────────────────────────────────────────────

#[test]
fn test_lock_limits_withdraw_and_collateral_keeps_yield() {
    let s = setup();
    let user = s.user_with_deposit(1_000);
    let locked = s.staking.lock(&s.lending, &user, &600);
    assert_eq!(s.staking.get_locked(&user), locked);
    assert_eq!(s.staking.get_free_position(&user), 400);

    // Pedir todo solo saca lo libre.
    assert_eq!(s.staking.withdraw(&user, &1_000, &0), 400);
    assert_eq!(s.staking.get_free_position(&user), 0);
    assert_eq!(s.staking.get_position(&user), 600);
    assert_eq!(
        s.staking.try_withdraw(&user, &1, &0),
        Err(Ok(Error::InsufficientPosition))
    );

    // Lo bloqueado sigue rindiendo.
    s.vault.set_rate(&11_000);
    assert_eq!(s.staking.get_position(&user), 660);
}

#[test]
fn test_lock_rejects_more_than_free_position() {
    let s = setup();
    let user = s.user_with_deposit(1_000);
    assert_eq!(
        s.staking.try_lock(&s.lending, &user, &1_001),
        Err(Ok(Error::InsufficientPosition))
    );
    s.staking.lock(&s.lending, &user, &800);
    assert_eq!(
        s.staking.try_lock(&s.lending, &user, &201),
        Err(Ok(Error::InsufficientPosition))
    );
    assert_eq!(
        s.staking.try_lock(&s.lending, &user, &0),
        Err(Ok(Error::InvalidAmount))
    );
}

#[test]
fn test_unlock_returns_free_position() {
    let s = setup();
    let user = s.user_with_deposit(1_000);
    let locked = s.staking.lock(&s.lending, &user, &600);
    assert_eq!(
        s.staking.try_unlock(&s.lending, &user, &(locked + 1)),
        Err(Ok(Error::InvalidAmount))
    );
    s.staking.unlock(&s.lending, &user, &locked);
    assert_eq!(s.staking.get_locked(&user), 0);
    assert_eq!(s.staking.withdraw(&user, &1_000, &1_000), 1_000);
}

#[test]
fn test_collateral_functions_need_lending_role() {
    let s = setup();
    let user = s.user_with_deposit(1_000);
    let locked = s.staking.lock(&s.lending, &user, &600);
    let thief = Address::generate(&s.env);

    for caller in [&thief, &user, &s.admin] {
        assert!(s.staking.try_lock(caller, &user, &100).is_err());
        assert!(s.staking.try_unlock(caller, &user, &locked).is_err());
        assert!(s.staking.try_seize(caller, &user, &100, &thief).is_err());
    }
    assert_eq!(s.staking.get_locked(&user), locked);
    assert_eq!(s.balance(&thief), 0);
}

#[test]
fn test_seize_needs_lending_signature() {
    let s = setup();
    let user = s.user_with_deposit(1_000);
    s.staking.lock(&s.lending, &user, &600);
    let to = Address::generate(&s.env);
    s.env.set_auths(&[]);
    assert!(s.staking.try_seize(&s.lending, &user, &100, &to).is_err());
    assert_eq!(s.balance(&to), 0);
}

#[test]
fn test_seize_takes_only_locked_and_pays_target() {
    let s = setup();
    let user = s.user_with_deposit(1_000);
    let locked = s.staking.lock(&s.lending, &user, &600);
    let pool = Address::generate(&s.env);

    let (received, burned) = s.staking.seize(&s.lending, &user, &200, &pool);
    assert_eq!(received, 200);
    assert_eq!(s.balance(&pool), 200);
    assert_eq!(s.staking.get_locked(&user), locked - burned);
    assert_eq!(s.staking.get_position(&user), 800);

    // Aunque pida más, solo toma lo bloqueado y deja la parte libre.
    let (received, _) = s.staking.seize(&s.lending, &user, &5_000, &pool);
    assert_eq!(received, 400);
    assert_eq!(s.staking.get_locked(&user), 0);
    assert_eq!(s.staking.get_position(&user), 400);
    assert_eq!(
        s.staking.try_seize(&s.lending, &user, &1, &pool),
        Err(Ok(Error::InsufficientPosition))
    );
}

#[test]
fn test_seize_does_not_touch_other_users() {
    let s = setup();
    let debtor = s.user_with_deposit(1_000);
    let saver = s.user_with_deposit(5_000);
    s.staking.lock(&s.lending, &debtor, &600);
    let pool = Address::generate(&s.env);
    s.staking.seize(&s.lending, &debtor, &600, &pool);
    assert_eq!(s.staking.get_position(&saver), 5_000);
    assert_eq!(s.staking.withdraw(&saver, &5_000, &5_000), 5_000);
}

#[test]
fn test_vault_loss_reduces_what_seize_recovers() {
    let s = setup();
    let user = s.user_with_deposit(1_000);
    s.staking.lock(&s.lending, &user, &1_000);
    s.vault.set_rate(&5_000);
    let pool = Address::generate(&s.env);
    let (received, _) = s.staking.seize(&s.lending, &user, &1_000, &pool);
    assert_eq!(received, 500);
    assert_eq!(s.staking.get_locked(&user), 0);
}

// ─── Estadísticas ──────────────────────────────────────────────────────────────

#[test]
fn test_stats_weight_balance_by_time() {
    let s = setup();
    let user = s.user_with_deposit(1_000);
    assert_eq!(s.staking.get_stats(&user).first_deposit, 1_000);

    s.env.ledger().set_timestamp(1_100);
    assert_eq!(s.staking.get_stats(&user).balance_seconds, 100_000);

    s.staking.withdraw(&user, &400, &0);
    s.env.ledger().set_timestamp(1_200);
    let stats = s.staking.get_stats(&user);
    assert_eq!(stats.net_balance, 600);
    assert_eq!(stats.balance_seconds, 160_000);
    assert_eq!(stats.first_deposit, 1_000);
}

#[test]
fn test_small_deposits_do_not_count_and_add_little_weight() {
    let s = setup();
    let spammer = Address::generate(&s.env);
    s.token_admin.mint(&spammer, &1_000);
    for _ in 0..30 {
        s.staking.deposit(&spammer, &1);
    }
    let stats = s.staking.get_stats(&spammer);
    assert_eq!(stats.valid_deposits, 0);
    assert_eq!(stats.tx_count, 30);

    s.staking.deposit(&spammer, &MIN_COUNTED);
    assert_eq!(s.staking.get_stats(&spammer).valid_deposits, 1);
}

#[test]
fn test_set_min_counted_deposit_needs_admin() {
    let s = setup();
    assert_eq!(
        s.staking.try_set_min_counted_deposit(&0),
        Err(Ok(Error::InvalidAmount))
    );
    s.env.set_auths(&[]);
    assert!(s.staking.try_set_min_counted_deposit(&5).is_err());
    s.env.mock_all_auths_allowing_non_root_auth();
    s.staking.set_min_counted_deposit(&5);

    let user = s.user_with_deposit(5);
    assert_eq!(s.staking.get_stats(&user).valid_deposits, 1);
}

// ─── Roles, pausa, TTL y upgrade ───────────────────────────────────────────────

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
fn test_pause_blocks_deposit_lock_and_seize_but_never_exits() {
    let s = setup();
    let user = s.user_with_deposit(1_000);
    s.token_admin.mint(&user, &100);
    let locked = s.staking.lock(&s.lending, &user, &400);

    s.staking.pause(&s.pauser);
    assert!(s.staking.try_deposit(&user, &100).is_err());
    assert!(s.staking.try_lock(&s.lending, &user, &100).is_err());
    assert!(s
        .staking
        .try_seize(&s.lending, &user, &100, &s.admin)
        .is_err());

    // Retirar lo libre y liberar colateral siguen funcionando.
    assert_eq!(s.staking.withdraw(&user, &600, &600), 600);
    s.staking.unlock(&s.lending, &user, &locked);
    assert_eq!(s.staking.withdraw(&user, &400, &400), 400);
}

#[test]
fn test_writes_extend_ttl() {
    let s = setup();
    let user = s.user_with_deposit(1_000);
    s.staking.lock(&s.lending, &user, &100);
    s.env.as_contract(&s.id, || {
        let storage = s.env.storage();
        for key in [
            DataKey::Shares(user.clone()),
            DataKey::Locked(user.clone()),
            DataKey::Stats(user.clone()),
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
    let issuer = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(issuer).address();
    let vault = env.register(MockVault, (token.clone(),));
    let id = env.register(
        WASM,
        (
            admin.clone(),
            admin.clone(),
            token,
            vault.clone(),
            MIN_COUNTED,
        ),
    );
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
