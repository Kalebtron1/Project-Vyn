#![cfg(test)]
extern crate std;

use crate::{VinculoSBT, VinculoSBTClient};
use soroban_sdk::{
    testutils::{Address as _, Events},
    Address, Env, Symbol, TryIntoVal, Val, Vec,
};

// ─── Helpers de test ───────────────────────────────────────────────────────────

struct Setup {
    env: Env,
    sbt: VinculoSBTClient<'static>,
    admin: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let sbt_addr = env.register_contract(None, VinculoSBT);
    let sbt = VinculoSBTClient::new(&env, &sbt_addr);
    sbt.init(&admin);

    Setup { env, sbt, admin }
}

/// Devuelve (topics, data) del último evento con `action` publicado por el contrato.
fn event_for(env: &Env, action: &str) -> (Vec<Val>, Val) {
    let expected = Symbol::new(env, action);
    let all = env.events().all();
    for i in (0..all.len()).rev() {
        let (_addr, topics, data) = all.get(i).unwrap();
        if topics.len() < 2 {
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

// ─── Eventos ───────────────────────────────────────────────────────────────────

#[test]
fn test_init_emits_event() {
    let s = setup();
    let (topics, _data) = event_for(&s.env, "init");

    assert_eq!(address_topic(&s.env, &topics, 1), s.admin);
    assert_eq!(
        s.sbt.name(),
        soroban_sdk::String::from_str(&s.env, "Vinculo Credito SBT")
    );
    assert_eq!(
        s.sbt.symbol(),
        soroban_sdk::String::from_str(&s.env, "VINC")
    );
}

#[test]
fn test_mint_emits_event_with_tier() {
    let s = setup();
    let user = Address::generate(&s.env);

    s.sbt.mint(&s.admin, &user, &2);

    let (topics, data) = event_for(&s.env, "mint");
    assert_eq!(address_topic(&s.env, &topics, 1), user);
    let tier: u32 = data.try_into_val(&s.env).unwrap();
    assert_eq!(tier, 2);
    assert_eq!(s.sbt.get_tier(&user), 2);
}

#[test]
fn test_revoke_emits_event_with_previous_tier() {
    let s = setup();
    let user = Address::generate(&s.env);
    s.sbt.mint(&s.admin, &user, &3);

    s.sbt.revoke(&s.admin, &user);

    let (topics, data) = event_for(&s.env, "revoke");
    assert_eq!(address_topic(&s.env, &topics, 1), user);
    let previous_tier: u32 = data.try_into_val(&s.env).unwrap();
    assert_eq!(previous_tier, 3);
    assert_eq!(s.sbt.get_tier(&user), 0);
}
