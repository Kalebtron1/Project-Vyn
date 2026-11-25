#![cfg(test)]
extern crate std;

use crate::{DataKey, VinculoSBT, VinculoSBTClient, LEDGERS_PER_DAY, TTL_EXTEND_TO, TTL_THRESHOLD};
use soroban_sdk::testutils::storage::{Instance as _, Persistent as _};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{Address, Env};

fn setup() -> (Env, VinculoSBTClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, VinculoSBT);
    let client = VinculoSBTClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.init(&admin);
    (env, client, admin)
}

fn advance(env: &Env, n: u32) {
    env.ledger().with_mut(|l| l.sequence_number += n);
}

fn tier_ttl(env: &Env, c: &VinculoSBTClient, user: &Address) -> u32 {
    env.as_contract(&c.address, || {
        env.storage().persistent().get_ttl(&DataKey::Tier(user.clone()))
    })
}

fn instance_ttl(env: &Env, c: &VinculoSBTClient) -> u32 {
    env.as_contract(&c.address, || env.storage().instance().get_ttl())
}

#[test]
fn mint_and_revoke_extend_ttl() {
    let (env, c, admin) = setup();
    let user = Address::generate(&env);
    c.mint(&admin, &user, &2);
    assert_eq!(tier_ttl(&env, &c, &user), TTL_EXTEND_TO);
    assert_eq!(instance_ttl(&env, &c), TTL_EXTEND_TO);

    advance(&env, TTL_EXTEND_TO - TTL_THRESHOLD + 10);
    c.revoke(&admin, &user);
    assert_eq!(tier_ttl(&env, &c, &user), TTL_EXTEND_TO);
    assert_eq!(instance_ttl(&env, &c), TTL_EXTEND_TO);
}

#[test]
fn tier_stays_live_when_read_periodically() {
    let (env, c, admin) = setup();
    let user = Address::generate(&env);
    c.mint(&admin, &user, &3);
    for _ in 0..5 {
        advance(&env, 40 * LEDGERS_PER_DAY);
        assert_eq!(c.get_tier(&user), 3);
    }
    assert_eq!(tier_ttl(&env, &c, &user), TTL_EXTEND_TO);
}

#[test]
fn read_above_threshold_does_not_extend() {
    let (env, c, admin) = setup();
    let user = Address::generate(&env);
    c.mint(&admin, &user, &1);
    advance(&env, 10);
    c.get_tier(&user);
    assert_eq!(tier_ttl(&env, &c, &user), TTL_EXTEND_TO - 10);
}

#[test]
fn missing_tier_read_does_not_panic() {
    let (env, c, _) = setup();
    let user = Address::generate(&env);
    assert_eq!(c.get_tier(&user), 0);
    c.token_uri(&user);
    advance(&env, TTL_EXTEND_TO - TTL_THRESHOLD + 10);
    c.name();
    assert_eq!(instance_ttl(&env, &c), TTL_EXTEND_TO);
}
