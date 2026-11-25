#![cfg(test)]
extern crate std;

use crate::{DataKey, VinculoLending, VinculoLendingClient, LEDGERS_PER_DAY, TTL_EXTEND_TO, TTL_THRESHOLD};
use soroban_sdk::testutils::storage::{Instance as _, Persistent as _};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{token::StellarAssetClient, Address, Env};
use vinculo_sbt::{VinculoSBT, VinculoSBTClient};

struct S {
    env: Env,
    lending: VinculoLendingClient<'static>,
    sbt: VinculoSBTClient<'static>,
    token: StellarAssetClient<'static>,
    admin: Address,
}

fn setup() -> S {
    let env = Env::default();
    env.mock_all_auths();
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let token = StellarAssetClient::new(&env, &sac.address());
    let admin = Address::generate(&env);
    let sbt_id = env.register_contract(None, VinculoSBT);
    let sbt = VinculoSBTClient::new(&env, &sbt_id);
    sbt.init(&admin);
    let lending = VinculoLendingClient::new(&env, &env.register_contract(None, VinculoLending));
    lending.init_lending(&sac.address(), &sbt_id, &Address::generate(&env));
    token.mint(&lending.address, &10_000_0000);
    S { env, lending, sbt, token, admin }
}

fn advance(env: &Env, n: u32) {
    env.ledger().with_mut(|l| l.sequence_number += n);
}

fn loan_ttl(s: &S, user: &Address) -> u32 {
    s.env.as_contract(&s.lending.address, || {
        s.env.storage().persistent().get_ttl(&DataKey::Loan(user.clone()))
    })
}

fn instance_ttl(s: &S) -> u32 {
    s.env.as_contract(&s.lending.address, || s.env.storage().instance().get_ttl())
}

#[test]
fn loan_writes_extend_ttl() {
    let s = setup();
    let user = Address::generate(&s.env);
    s.sbt.mint(&s.admin, &user, &1);
    s.lending.request_loan(&user, &1000, &12);
    assert_eq!(loan_ttl(&s, &user), TTL_EXTEND_TO);
    assert_eq!(instance_ttl(&s), TTL_EXTEND_TO);

    // Poco avance: el token de prueba (TTL corto por defecto) se archivaría antes.
    advance(&s.env, 10);
    s.token.mint(&user, &100);
    s.lending.repay(&user, &100);
    assert!(loan_ttl(&s, &user) >= TTL_EXTEND_TO - 10);
    assert!(instance_ttl(&s) >= TTL_EXTEND_TO - 10);
}

#[test]
fn loan_stays_live_across_ledger_advances() {
    let s = setup();
    let user = Address::generate(&s.env);
    s.sbt.mint(&s.admin, &user, &1);
    s.lending.request_loan(&user, &1000, &12);
    for _ in 0..5 {
        advance(&s.env, 40 * LEDGERS_PER_DAY);
        assert_eq!(s.lending.get_loan(&user).principal, 1000);
        s.sbt.get_tier(&user); // el SBT también se mantiene vivo
    }
    assert_eq!(s.sbt.get_tier(&user), 1);
    assert_eq!(loan_ttl(&s, &user), TTL_EXTEND_TO);
}

#[test]
fn view_without_loan_does_not_panic_and_extends_instance() {
    let s = setup();
    let user = Address::generate(&s.env);
    advance(&s.env, TTL_EXTEND_TO - TTL_THRESHOLD + 10);
    assert_eq!(s.lending.get_loan(&user).total_owed, 0);
    assert_eq!(instance_ttl(&s), TTL_EXTEND_TO);
}
