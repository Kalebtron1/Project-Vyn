#![cfg(test)]
extern crate std;

use crate::{VinculoLending, VinculoLendingClient};
use soroban_sdk::{
    testutils::{Address as _, Events},
    token, Address, Env, Symbol, TryIntoVal, Val, Vec,
};
use vinculo_sbt::{VinculoSBT, VinculoSBTClient};

// ─── Helpers de test ───────────────────────────────────────────────────────────

struct Setup {
    env: Env,
    lending: VinculoLendingClient<'static>,
    lending_addr: Address,
    sbt: VinculoSBTClient<'static>,
    admin: Address,
    treasury: Address,
    token_admin: token::StellarAssetClient<'static>,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    // Token de prueba (Stellar Asset Contract).
    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let token_addr = sac.address();
    let token_admin = token::StellarAssetClient::new(&env, &token_addr);

    // SBT con el admin que mintea tiers.
    let admin = Address::generate(&env);
    let sbt_addr = env.register_contract(None, VinculoSBT);
    let sbt = VinculoSBTClient::new(&env, &sbt_addr);
    sbt.init(&admin);

    let treasury = Address::generate(&env);
    let lending_addr = env.register_contract(None, VinculoLending);
    let lending = VinculoLendingClient::new(&env, &lending_addr);
    lending.init_lending(&token_addr, &sbt_addr, &treasury);

    Setup {
        env,
        lending,
        lending_addr,
        sbt,
        admin,
        treasury,
        token_admin,
    }
}

/// Devuelve (topics, data) del último evento con `action` publicado por `contract`.
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

fn payload(env: &Env, data: &Val) -> Vec<Val> {
    data.try_into_val(env).unwrap()
}

// ─── Eventos ───────────────────────────────────────────────────────────────────

#[test]
fn test_init_emits_event() {
    let s = setup();
    let (topics, data) = event_for(&s.env, &s.lending_addr, "init");

    assert_eq!(address_topic(&s.env, &topics, 1), s.treasury);
    let values = payload(&s.env, &data);
    let token_addr: Address = values.get(0).unwrap().try_into_val(&s.env).unwrap();
    assert_eq!(token_addr, s.token_admin.address);
}

#[test]
fn test_fund_pool_emits_event() {
    let s = setup();
    let funder = Address::generate(&s.env);
    s.token_admin.mint(&funder, &10_000);

    s.lending.fund_pool(&funder, &10_000);

    let (topics, data) = event_for(&s.env, &s.lending_addr, "pool_fund");
    assert_eq!(address_topic(&s.env, &topics, 1), funder);
    let amount: i128 = data.try_into_val(&s.env).unwrap();
    assert_eq!(amount, 10_000);
    assert_eq!(s.lending.get_pool_balance(), 10_000);
}

#[test]
fn test_request_loan_emits_event() {
    let s = setup();
    let funder = Address::generate(&s.env);
    let user = Address::generate(&s.env);
    s.token_admin.mint(&funder, &10_000);
    s.lending.fund_pool(&funder, &10_000);
    s.sbt.mint(&s.admin, &user, &1);

    s.lending.request_loan(&user, &1_000, &1);

    let (topics, data) = event_for(&s.env, &s.lending_addr, "loan");
    assert_eq!(address_topic(&s.env, &topics, 1), user);
    let values = payload(&s.env, &data);
    let principal: i128 = values.get(0).unwrap().try_into_val(&s.env).unwrap();
    let total_owed: i128 = values.get(1).unwrap().try_into_val(&s.env).unwrap();
    let due: u64 = values.get(2).unwrap().try_into_val(&s.env).unwrap();
    assert_eq!((principal, total_owed, due), (1_000, 1_050, 60));

    let loan = s.lending.get_loan(&user);
    assert_eq!(loan.principal, 1_000);
    assert_eq!(loan.total_owed, 1_050);
}

#[test]
fn test_repay_emits_event() {
    let s = setup();
    let funder = Address::generate(&s.env);
    let user = Address::generate(&s.env);
    s.token_admin.mint(&funder, &10_000);
    s.lending.fund_pool(&funder, &10_000);
    s.sbt.mint(&s.admin, &user, &1);
    s.lending.request_loan(&user, &1_000, &1);
    s.token_admin.mint(&user, &1_050);

    s.lending.repay(&user, &1_050);

    let (topics, data) = event_for(&s.env, &s.lending_addr, "repay");
    assert_eq!(address_topic(&s.env, &topics, 1), user);
    let values = payload(&s.env, &data);
    let paid: i128 = values.get(0).unwrap().try_into_val(&s.env).unwrap();
    let remaining: i128 = values.get(1).unwrap().try_into_val(&s.env).unwrap();
    assert_eq!((paid, remaining), (1_050, 0));
    assert_eq!(s.lending.get_accrued_interest(), 50);
}

#[test]
fn test_withdraw_interest_emits_event() {
    let s = setup();
    let funder = Address::generate(&s.env);
    let user = Address::generate(&s.env);
    s.token_admin.mint(&funder, &10_000);
    s.lending.fund_pool(&funder, &10_000);
    s.sbt.mint(&s.admin, &user, &1);
    s.lending.request_loan(&user, &1_000, &1);
    s.token_admin.mint(&user, &1_050);
    s.lending.repay(&user, &1_050);

    s.lending.withdraw_interest(&50);

    let (topics, data) = event_for(&s.env, &s.lending_addr, "interest_withdraw");
    assert_eq!(address_topic(&s.env, &topics, 1), s.treasury);
    let amount: i128 = data.try_into_val(&s.env).unwrap();
    assert_eq!(amount, 50);
    assert_eq!(
        token::Client::new(&s.env, &s.token_admin.address).balance(&s.treasury),
        50
    );
    assert_eq!(s.lending.get_accrued_interest(), 0);
}

#[test]
fn test_withdraw_pool_emits_event() {
    let s = setup();
    let funder = Address::generate(&s.env);
    s.token_admin.mint(&funder, &10_000);
    s.lending.fund_pool(&funder, &10_000);

    s.lending.withdraw_pool(&4_000);

    let (topics, data) = event_for(&s.env, &s.lending_addr, "pool_withdraw");
    assert_eq!(address_topic(&s.env, &topics, 1), s.treasury);
    let amount: i128 = data.try_into_val(&s.env).unwrap();
    assert_eq!(amount, 4_000);
    assert_eq!(s.lending.get_pool_balance(), 6_000);
}
