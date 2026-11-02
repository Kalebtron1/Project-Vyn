#![cfg(test)]
extern crate std;

use crate::{
    DataKey, LoanHistory, ReputationConfig, TierRule, UserStats, VinculoSBT, VinculoSBTClient,
    TTL_EXTEND_TO,
};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{storage::Instance as _, storage::Persistent as _, Address as _, Ledger as _},
    vec, Address, Env, String, Symbol, Vec,
};

const WASM: &[u8] = include_bytes!("../../target/wasm32v1-none/release/vinculo_sbt.wasm");
const USDC: i128 = 10_000_000;
const DAY: u64 = 86_400;
const NOW: u64 = 1_000 * DAY;

#[contracttype]
enum MockKey {
    Stats(Address),
    History(Address),
}

#[contract]
pub struct MockSavings;

#[contractimpl]
impl MockSavings {
    pub fn set_stats(env: Env, user: Address, stats: UserStats) {
        env.storage()
            .persistent()
            .set(&MockKey::Stats(user), &stats);
    }

    pub fn get_stats(env: Env, user: Address) -> UserStats {
        env.storage()
            .persistent()
            .get(&MockKey::Stats(user))
            .unwrap_or_default()
    }
}

#[contract]
pub struct MockLending;

#[contractimpl]
impl MockLending {
    pub fn set_history(env: Env, user: Address, history: LoanHistory) {
        env.storage()
            .persistent()
            .set(&MockKey::History(user), &history);
    }

    pub fn get_history(env: Env, user: Address) -> LoanHistory {
        env.storage()
            .persistent()
            .get(&MockKey::History(user))
            .unwrap_or_default()
    }
}

fn rule(usdc: i128, days: u64, deposits: u32, on_time: u32, allow_defaults: bool) -> TierRule {
    TierRule {
        min_balance: usdc * USDC,
        min_seconds: days * DAY,
        min_valid_deposits: deposits,
        min_repaid_on_time: on_time,
        allow_defaults,
    }
}

fn config() -> ReputationConfig {
    ReputationConfig {
        plata: rule(10, 30, 3, 0, true),
        oro: rule(50, 90, 3, 1, true),
        diamante: rule(200, 180, 3, 3, false),
        platino: rule(1_000, 365, 3, 6, false),
        default_cooldown: 90 * DAY,
    }
}

fn uris(env: &Env) -> Vec<String> {
    let mut list = vec![env];
    for name in ["bronce", "plata", "oro", "diamante", "platino"] {
        list.push_back(String::from_str(env, name));
    }
    list
}

struct Setup {
    env: Env,
    id: Address,
    client: VinculoSBTClient<'static>,
    admin: Address,
    pauser: Address,
    savings: MockSavingsClient<'static>,
    savings_id: Address,
    lending: MockLendingClient<'static>,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(NOW);
    let admin = Address::generate(&env);
    let pauser = Address::generate(&env);
    let savings_id = env.register(MockSavings, ());
    let savings = MockSavingsClient::new(&env, &savings_id);
    let lending_id = env.register(MockLending, ());
    let lending = MockLendingClient::new(&env, &lending_id);
    let id = env.register(
        VinculoSBT,
        (
            admin.clone(),
            pauser.clone(),
            savings_id.clone(),
            config(),
            uris(&env),
        ),
    );
    let client = VinculoSBTClient::new(&env, &id);
    client.set_lending(&lending_id);
    Setup {
        env,
        id,
        client,
        admin,
        pauser,
        savings,
        savings_id,
        lending,
    }
}

impl Setup {
    /// Usuario que mantuvo `usdc` durante `days` días, con `deposits` depósitos.
    fn saver(&self, usdc: i128, days: u64, deposits: u32) -> Address {
        let user = Address::generate(&self.env);
        self.savings.set_stats(
            &user,
            &UserStats {
                net_balance: usdc * USDC,
                balance_seconds: usdc * USDC * i128::from(days * DAY),
                first_deposit: NOW - days * DAY,
                valid_deposits: deposits,
                ..UserStats::default()
            },
        );
        user
    }

    fn history(&self, user: &Address, history: LoanHistory) {
        self.lending.set_history(user, &history);
    }

    fn on_time(&self, user: &Address, count: u32) {
        self.history(
            user,
            LoanHistory {
                repaid_on_time: count,
                ..LoanHistory::default()
            },
        );
    }
}

// ─── Reglas de cada nivel ──────────────────────────────────────────────────────

#[test]
fn new_user_is_bronce() {
    let s = setup();
    let user = Address::generate(&s.env);
    assert_eq!(s.client.preview_tier(&user), 0);
    assert_eq!(s.client.get_tier(&user), 0);
    assert_eq!(
        s.client.token_uri(&user),
        String::from_str(&s.env, "bronce")
    );
}

#[test]
fn plata_needs_balance_time_and_valid_deposits() {
    let s = setup();
    assert_eq!(s.client.preview_tier(&s.saver(10, 30, 3)), 1);
    assert_eq!(s.client.preview_tier(&s.saver(10, 30, 2)), 0);
    assert_eq!(s.client.preview_tier(&s.saver(9, 30, 3)), 0);
    assert_eq!(s.client.preview_tier(&s.saver(10, 29, 3)), 0);
}

#[test]
fn many_tiny_deposits_do_not_reach_plata() {
    let s = setup();
    let spammer = Address::generate(&s.env);
    s.savings.set_stats(
        &spammer,
        &UserStats {
            net_balance: 31,
            balance_seconds: 31 * i128::from(365 * DAY),
            first_deposit: NOW - 365 * DAY,
            valid_deposits: 0,
            tx_count: 31,
            ..UserStats::default()
        },
    );
    assert_eq!(s.client.preview_tier(&spammer), 0);
}

#[test]
fn big_balance_for_a_moment_does_not_buy_a_tier() {
    let s = setup();
    let whale = Address::generate(&s.env);
    s.savings.set_stats(
        &whale,
        &UserStats {
            net_balance: 1_000_000 * USDC,
            balance_seconds: 1_000_000 * USDC * 60,
            first_deposit: NOW - 60,
            valid_deposits: 3,
            ..UserStats::default()
        },
    );
    assert_eq!(s.client.preview_tier(&whale), 0);
}

#[test]
fn withdrawing_below_the_balance_lowers_the_tier() {
    let s = setup();
    let user = s.saver(10, 30, 3);
    assert_eq!(s.client.refresh_tier(&user), 1);
    let mut stats = s.savings.get_stats(&user);
    stats.net_balance = USDC;
    s.savings.set_stats(&user, &stats);
    assert_eq!(s.client.refresh_tier(&user), 0);
    assert_eq!(s.client.get_tier(&user), 0);
}

#[test]
fn oro_needs_one_loan_repaid_on_time() {
    let s = setup();
    let user = s.saver(50, 90, 3);
    assert_eq!(s.client.preview_tier(&user), 1);
    s.on_time(&user, 1);
    assert_eq!(s.client.preview_tier(&user), 2);
}

#[test]
fn diamante_and_platino_need_history_and_no_defaults() {
    let s = setup();
    let diamante = s.saver(200, 180, 3);
    s.on_time(&diamante, 2);
    assert_eq!(s.client.preview_tier(&diamante), 2);
    s.on_time(&diamante, 3);
    assert_eq!(s.client.preview_tier(&diamante), 3);

    let platino = s.saver(1_000, 365, 3);
    s.on_time(&platino, 5);
    assert_eq!(s.client.preview_tier(&platino), 3);
    s.on_time(&platino, 6);
    assert_eq!(s.client.preview_tier(&platino), 4);

    s.history(
        &platino,
        LoanHistory {
            repaid_on_time: 6,
            defaults: 1,
            last_default_at: NOW - 365 * DAY,
            ..LoanHistory::default()
        },
    );
    assert_eq!(s.client.preview_tier(&platino), 2);
}

#[test]
fn late_payments_do_not_count_as_on_time() {
    let s = setup();
    let user = s.saver(50, 90, 3);
    s.history(
        &user,
        LoanHistory {
            repaid_late: 5,
            ..LoanHistory::default()
        },
    );
    assert_eq!(s.client.preview_tier(&user), 1);
}

#[test]
fn default_means_bronce_during_cooldown() {
    let s = setup();
    let user = s.saver(50, 90, 3);
    let default_at = NOW;
    s.history(
        &user,
        LoanHistory {
            repaid_on_time: 1,
            defaults: 1,
            last_default_at: default_at,
            ..LoanHistory::default()
        },
    );
    assert_eq!(s.client.preview_tier(&user), 0);

    s.env.ledger().set_timestamp(default_at + 90 * DAY - 1);
    assert_eq!(s.client.preview_tier(&user), 0);
    s.env.ledger().set_timestamp(default_at + 90 * DAY);
    assert_eq!(s.client.preview_tier(&user), 2);
}

#[test]
fn unpaid_debt_keeps_bronce_after_cooldown() {
    let s = setup();
    let user = s.saver(1_000, 365, 3);
    s.history(
        &user,
        LoanHistory {
            defaults: 1,
            last_default_at: NOW - 365 * DAY,
            unpaid_debt: 1,
            ..LoanHistory::default()
        },
    );
    assert_eq!(s.client.preview_tier(&user), 0);
    s.history(
        &user,
        LoanHistory {
            defaults: 1,
            last_default_at: NOW - 365 * DAY,
            ..LoanHistory::default()
        },
    );
    assert_eq!(s.client.preview_tier(&user), 1);
}

#[test]
fn compute_tier_uses_the_given_history_and_saves_nothing() {
    let s = setup();
    let user = s.saver(50, 90, 3);
    let history = LoanHistory {
        repaid_on_time: 1,
        ..LoanHistory::default()
    };
    assert_eq!(s.client.compute_tier(&user, &history), 2);
    assert_eq!(s.client.get_tier(&user), 0);
    assert_eq!(s.client.preview_tier(&user), 1);
}

// ─── refresh_tier ──────────────────────────────────────────────────────────────

#[test]
fn anyone_can_refresh_without_signatures_and_uri_follows() {
    let s = setup();
    let user = s.saver(10, 30, 3);
    s.env.set_auths(&[]);
    assert_eq!(s.client.refresh_tier(&user), 1);
    assert_eq!(s.client.get_tier(&user), 1);
    assert_eq!(s.client.token_uri(&user), String::from_str(&s.env, "plata"));
}

#[test]
#[should_panic]
fn preview_fails_clearly_without_lending() {
    let env = Env::default();
    env.mock_all_auths();
    let a = Address::generate(&env);
    let savings = env.register(MockSavings, ());
    let id = env.register(
        VinculoSBT,
        (a.clone(), a.clone(), savings, config(), uris(&env)),
    );
    VinculoSBTClient::new(&env, &id).preview_tier(&a);
}

// ─── Administración ────────────────────────────────────────────────────────────

#[test]
fn constructor_assigns_only_the_given_roles() {
    let s = setup();
    assert_eq!(s.client.get_admin(), Some(s.admin.clone()));
    let pauser = Symbol::new(&s.env, "pauser");
    assert!(s.client.has_role(&s.pauser, &pauser).is_some());
    assert!(s.client.has_role(&s.admin, &pauser).is_none());
}

#[test]
#[should_panic]
fn constructor_rejects_wrong_uri_count() {
    let env = Env::default();
    let a = Address::generate(&env);
    let savings = env.register(MockSavings, ());
    let bad: Vec<String> = vec![&env, String::from_str(&env, "solo-una")];
    env.register(VinculoSBT, (a.clone(), a, savings, config(), bad));
}

#[test]
fn admin_functions_need_the_admin() {
    let s = setup();
    let other = Address::generate(&s.env);
    s.env.set_auths(&[]);
    assert!(s.client.try_set_lending(&other).is_err());
    assert!(s.client.try_set_config(&config()).is_err());
    assert!(s.client.try_set_metadata_uris(&uris(&s.env)).is_err());
}

#[test]
fn set_config_changes_rules_and_rejects_bad_order() {
    let s = setup();
    let user = s.saver(10, 1, 3);
    assert_eq!(s.client.preview_tier(&user), 0);

    let mut easier = config();
    easier.plata = rule(10, 1, 3, 0, true);
    s.client.set_config(&easier);
    assert_eq!(s.client.get_config(), easier);
    assert_eq!(s.client.preview_tier(&user), 1);

    let mut inverted = config();
    inverted.oro = rule(1, 90, 3, 1, true);
    assert!(s.client.try_set_config(&inverted).is_err());
    let mut zero = config();
    zero.plata = rule(0, 30, 3, 0, true);
    assert!(s.client.try_set_config(&zero).is_err());
}

#[test]
fn only_admin_changes_metadata() {
    let s = setup();
    let new_uris: Vec<String> = vec![
        &s.env,
        String::from_str(&s.env, "a"),
        String::from_str(&s.env, "b"),
        String::from_str(&s.env, "c"),
        String::from_str(&s.env, "d"),
        String::from_str(&s.env, "e"),
    ];
    s.client.set_metadata_uris(&new_uris);
    let user = Address::generate(&s.env);
    assert_eq!(s.client.token_uri(&user), String::from_str(&s.env, "a"));
}

#[test]
fn only_pauser_pauses_and_only_admin_unpauses() {
    let s = setup();
    let stranger = Address::generate(&s.env);
    assert!(s.client.try_pause(&stranger).is_err());
    assert!(s.client.try_pause(&s.admin).is_err());
    assert!(!s.client.paused());

    s.client.pause(&s.pauser);
    assert!(s.client.paused());

    s.env.set_auths(&[]);
    assert!(s.client.try_unpause(&s.pauser).is_err());
    assert!(s.client.paused());

    s.env.mock_all_auths();
    s.client.unpause(&s.admin);
    assert!(!s.client.paused());
}

#[test]
fn pause_blocks_refresh_but_not_reads() {
    let s = setup();
    let user = s.saver(10, 30, 3);
    s.client.pause(&s.pauser);
    assert!(s.client.try_refresh_tier(&user).is_err());
    assert_eq!(s.client.preview_tier(&user), 1);
    assert_eq!(s.client.compute_tier(&user, &LoanHistory::default()), 1);
}

#[test]
fn writes_extend_ttl() {
    let s = setup();
    let user = s.saver(10, 30, 3);
    s.client.refresh_tier(&user);
    s.env.as_contract(&s.id, || {
        let key = DataKey::Tier(user.clone());
        assert_eq!(s.env.storage().persistent().get_ttl(&key), TTL_EXTEND_TO);
        assert_eq!(s.env.storage().instance().get_ttl(), TTL_EXTEND_TO);
    });
}

#[test]
fn upgrade_requires_admin_and_keeps_state() {
    let s = setup();
    let id = s.env.register(
        WASM,
        (
            s.admin.clone(),
            s.pauser.clone(),
            s.savings_id.clone(),
            config(),
            uris(&s.env),
        ),
    );
    let client = VinculoSBTClient::new(&s.env, &id);
    let hash = s.env.deployer().upload_contract_wasm(WASM);

    s.env.set_auths(&[]);
    assert!(client.try_upgrade(&hash, &s.pauser).is_err());

    s.env.mock_all_auths();
    client.upgrade(&hash, &s.admin);
    assert_eq!(client.get_config(), config());
    assert_eq!(client.get_admin(), Some(s.admin.clone()));
    // Sigue siendo actualizable después del upgrade.
    client.upgrade(&hash, &s.admin);
}
