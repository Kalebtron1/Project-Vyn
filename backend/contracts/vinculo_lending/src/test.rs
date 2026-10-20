#![cfg(test)]
extern crate std;

use crate::{VinculoLending, VinculoLendingClient};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token, Address, Env, Symbol, TryFromVal,
};
use vinculo_sbt::{VinculoSBT, VinculoSBTClient};

const PRINCIPAL: i128 = 10_000_0000; // 10 XLM en stroops (7 decimales)

/// ceil(principal * 500 * months / 120_000)
fn expected_interest(months: u64) -> i128 {
    let numer = PRINCIPAL * 500 * (months as i128);
    let denom: i128 = 12 * 10_000;
    (numer + denom - 1) / denom
}

struct Setup {
    env: Env,
    lending: VinculoLendingClient<'static>,
    user: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| {
        li.timestamp = 1_000;
    });

    let issuer = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(issuer).address();
    let token_admin = token::StellarAssetClient::new(&env, &token_addr);

    let admin = Address::generate(&env);
    let sbt_addr = env.register_contract(None, VinculoSBT);
    let sbt = VinculoSBTClient::new(&env, &sbt_addr);
    sbt.init(&admin);

    let treasury = Address::generate(&env);
    let user = Address::generate(&env);
    sbt.mint(&admin, &user, &1);

    let lending_addr = env.register_contract(None, VinculoLending);
    let lending = VinculoLendingClient::new(&env, &lending_addr);
    lending.init_lending(&token_addr, &sbt_addr, &treasury);

    token_admin.mint(&treasury, &1_000_000_0000);
    lending.fund_pool(&treasury, &1_000_000_0000);
    // El usuario recibe el principal al pedir el préstamo, pero el interés
    // tiene que salir de su saldo. Dejamos XLM de sobra para cubrir el pago.
    token_admin.mint(&user, &1_000_000_0000);

    Setup { env, lending, user }
}

#[test]
fn test_interest_varies_by_term() {
    let terms = [1u64, 3, 6, 12];
    for months in terms {
        let s = setup();
        s.lending
            .request_loan(&s.user, &PRINCIPAL, &months);
        let loan = s.lending.get_loan(&s.user);
        let interest = expected_interest(months);
        assert_eq!(loan.interest, interest, "months={months}");
        assert_eq!(loan.total_owed, PRINCIPAL + interest);
        assert_eq!(loan.apy_bps, 500);
        assert_eq!(loan.months, months);
        assert_eq!(loan.due_timestamp, 1_000 + months * 60);
        assert!(!loan.is_overdue);
        assert!(!s.lending.is_overdue(&s.user));
    }
}

#[test]
fn test_repay_books_stored_interest() {
    let s = setup();
    s.lending.request_loan(&s.user, &PRINCIPAL, &1);
    let loan = s.lending.get_loan(&s.user);
    s.lending.repay(&s.user, &loan.total_owed);
    assert_eq!(s.lending.get_accrued_interest(), loan.interest);
    assert_eq!(s.lending.get_loan(&s.user).total_owed, 0);
    assert!(!s.lending.is_overdue(&s.user));
}

#[test]
fn test_overdue_after_due_timestamp() {
    let s = setup();
    s.lending.request_loan(&s.user, &PRINCIPAL, &1);
    let due = s.lending.get_loan(&s.user).due_timestamp;

    s.env.ledger().with_mut(|li| {
        li.timestamp = due - 1;
    });
    assert!(!s.lending.is_overdue(&s.user));
    assert!(!s.lending.get_loan(&s.user).is_overdue);

    s.env.ledger().with_mut(|li| {
        li.timestamp = due;
    });
    assert!(s.lending.is_overdue(&s.user));
    assert!(s.lending.get_loan(&s.user).is_overdue);
}

fn assert_recent_event(env: &Env, name: &str) {
    let expected = Symbol::new(env, name);
    let events = env.events().all();
    let found = events.iter().any(|(_, topics, _)| {
        topics
            .get(0)
            .and_then(|topic| Symbol::try_from_val(env, &topic).ok())
            .as_ref()
            == Some(&expected)
    });
    assert!(found, "missing event {name}");
}

#[test]
fn test_state_changes_emit_events() {
    let env = Env::default();
    env.mock_all_auths();
    let issuer = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(issuer).address();
    let token_admin = token::StellarAssetClient::new(&env, &token_addr);
    let admin = Address::generate(&env);
    let sbt_addr = env.register_contract(None, VinculoSBT);
    let sbt = VinculoSBTClient::new(&env, &sbt_addr);
    sbt.init(&admin);
    let treasury = Address::generate(&env);
    let user = Address::generate(&env);
    sbt.mint(&admin, &user, &1);

    let lending_addr = env.register_contract(None, VinculoLending);
    let lending = VinculoLendingClient::new(&env, &lending_addr);
    lending.init_lending(&token_addr, &sbt_addr, &treasury);
    assert_recent_event(&env, "init_lending");

    token_admin.mint(&treasury, &1_000_000_0000);
    lending.fund_pool(&treasury, &1_000_000_0000);
    assert_recent_event(&env, "fund_pool");

    token_admin.mint(&user, &1_000_000_0000);
    lending.request_loan(&user, &PRINCIPAL, &1);
    assert_recent_event(&env, "loan");

    let owed = lending.get_loan(&user).total_owed;
    lending.repay(&user, &owed);
    assert_recent_event(&env, "repay");

    let interest = lending.get_accrued_interest();
    lending.withdraw_interest(&interest);
    assert_recent_event(&env, "withdraw_interest");

    lending.withdraw_pool(&1);
    assert_recent_event(&env, "withdraw_pool");
}
