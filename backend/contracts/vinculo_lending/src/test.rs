#![cfg(test)]
extern crate std;

use crate::{VinculoLending, VinculoLendingClient};
use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Ledger},
    token::{self, StellarAssetClient},
    Address, Env, IntoVal, Symbol,
};
use vinculo_sbt::{VinculoSBT, VinculoSBTClient};

struct Setup {
    env: Env,
    lending_addr: Address,
    lending: VinculoLendingClient<'static>,
    sbt_admin: Address,
    sbt: VinculoSBTClient<'static>,
    treasury: Address,
    token_addr: Address,
    token_admin: StellarAssetClient<'static>,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let token_addr = sac.address();
    let token_admin = StellarAssetClient::new(&env, &token_addr);

    let sbt_admin = Address::generate(&env);
    let sbt_addr = env.register_contract(None, VinculoSBT);
    let sbt = VinculoSBTClient::new(&env, &sbt_addr);
    sbt.init(&sbt_admin);

    let treasury = Address::generate(&env);
    let lending_addr = env.register_contract(None, VinculoLending);
    let lending = VinculoLendingClient::new(&env, &lending_addr);
    lending.init_lending(&token_addr, &sbt_addr, &treasury);

    Setup {
        env,
        lending_addr,
        lending,
        sbt_admin,
        sbt,
        treasury,
        token_addr,
        token_admin,
    }
}

fn fund(s: &Setup, amount: i128) {
    let funder = Address::generate(&s.env);
    s.token_admin.mint(&funder, &amount);
    s.lending.fund_pool(&funder, &amount);
}

#[test]
fn test_init_sets_treasury_and_pool_starts_empty() {
    let s = setup();
    assert_eq!(s.lending.get_treasury(), s.treasury);
    assert_eq!(s.lending.get_pool_balance(), 0);
    assert_eq!(s.lending.get_accrued_interest(), 0);
}

#[test]
#[should_panic(expected = "El contrato ya fue inicializado")]
fn test_reinit_panics() {
    let s = setup();
    let other_token = Address::generate(&s.env);
    let other_sbt = Address::generate(&s.env);
    let other_treasury = Address::generate(&s.env);
    s.lending
        .init_lending(&other_token, &other_sbt, &other_treasury);
}

#[test]
fn test_fund_pool_transfers_tokens_to_contract() {
    let s = setup();
    fund(&s, 10_000_000_000);
    assert_eq!(s.lending.get_pool_balance(), 10_000_000_000);
}

#[test]
#[should_panic(expected = "no valid SBT tier for credit")]
fn test_request_loan_without_sbt_panics() {
    let s = setup();
    fund(&s, 10_000_000_000);
    let user = Address::generate(&s.env);
    s.lending.request_loan(&user, &1_000_000_000, &1);
}

#[test]
#[should_panic(expected = "invalid term (months)")]
fn test_request_loan_invalid_term_panics() {
    let s = setup();
    fund(&s, 10_000_000_000);
    let user = Address::generate(&s.env);
    s.sbt.mint(&s.sbt_admin, &user, &1);
    s.lending.request_loan(&user, &1_000_000_000, &2);
}

#[test]
#[should_panic(expected = "amount exceeds tier limit")]
fn test_request_loan_exceeding_tier_limit_panics() {
    let s = setup();
    fund(&s, 50_000_000_000);
    let user = Address::generate(&s.env);
    s.sbt.mint(&s.sbt_admin, &user, &1); // Límite tier 1 = 3_000_000_000
    s.lending.request_loan(&user, &3_000_000_001, &1);
}

#[test]
#[should_panic(expected = "insufficient pool liquidity")]
fn test_request_loan_insufficient_liquidity_panics() {
    let s = setup();
    fund(&s, 500_000_000);
    let user = Address::generate(&s.env);
    s.sbt.mint(&s.sbt_admin, &user, &1);
    s.lending.request_loan(&user, &1_000_000_000, &1);
}

#[test]
#[should_panic(expected = "active loan exists")]
fn test_request_loan_duplicate_active_loan_panics() {
    let s = setup();
    fund(&s, 10_000_000_000);
    let user = Address::generate(&s.env);
    s.sbt.mint(&s.sbt_admin, &user, &1);
    s.lending.request_loan(&user, &1_000_000_000, &1);
    s.lending.request_loan(&user, &500_000_000, &1);
}

#[test]
fn test_request_loan_and_partial_then_full_repay() {
    let s = setup();
    fund(&s, 20_000_000_000);
    s.env.ledger().with_mut(|li| {
        li.timestamp = 1_000;
    });

    let user = Address::generate(&s.env);
    s.sbt.mint(&s.sbt_admin, &user, &2); // Oro (hasta 600 XLM)

    let principal = 4_000_000_000i128; // 400 XLM
    s.lending.request_loan(&user, &principal, &3);

    let loan = s.lending.get_loan(&user);
    assert_eq!(loan.principal, principal);
    assert_eq!(loan.total_owed, 4_200_000_000); // +5% (200_000_000)
    assert_eq!(loan.due_timestamp, 1_180);
    assert_eq!(loan.months, 3);
    assert_eq!(loan.apy_bps, 500);

    let token_client = token::Client::new(&s.env, &s.token_addr);
    assert_eq!(token_client.balance(&user), principal);
    assert_eq!(s.lending.get_pool_balance(), 16_000_000_000);

    // Abono parcial de 2_000_000_000
    s.lending.repay(&user, &2_000_000_000);
    let after_partial = s.lending.get_loan(&user);
    assert_eq!(after_partial.total_owed, 2_200_000_000);
    assert_eq!(s.lending.get_accrued_interest(), 0);

    // Fondea al usuario con interés extra y envía un monto mayor al saldo pendiente
    s.token_admin.mint(&user, &500_000_000);
    s.lending.repay(&user, &2_500_000_000); // Se cobra solo 2_200_000_000

    let after_full = s.lending.get_loan(&user);
    assert_eq!(after_full.total_owed, 0);
    assert_eq!(after_full.principal, 0);
    assert_eq!(token_client.balance(&user), 300_000_000); // El excedente (300_000_000) no se tocó
    assert_eq!(s.lending.get_accrued_interest(), 200_000_000);
    assert_eq!(s.lending.get_pool_balance(), 20_200_000_000);
}

#[test]
#[should_panic(expected = "no active loan")]
fn test_repay_without_active_loan_panics() {
    let s = setup();
    let user = Address::generate(&s.env);
    s.lending.repay(&user, &100_000_000);
}

#[test]
fn test_withdraw_interest_and_withdraw_pool_isolation() {
    let s = setup();
    fund(&s, 10_000_000_000);

    let user = Address::generate(&s.env);
    s.sbt.mint(&s.sbt_admin, &user, &1);

    let principal = 2_000_000_000i128; // Interés = 100_000_000
    s.lending.request_loan(&user, &principal, &1);
    s.token_admin.mint(&user, &100_000_000);
    s.lending.repay(&user, &2_100_000_000);

    // Balance total en el contrato = 10_100_000_000 (10_000_000_000 principal + 100_000_000 interés)
    assert_eq!(s.lending.get_pool_balance(), 10_100_000_000);
    assert_eq!(s.lending.get_accrued_interest(), 100_000_000);

    // `withdraw_pool` nunca toca los 100_000_000 de interés reservado a la tesorería
    let pool_withdrawn = s.lending.withdraw_pool(&50_000_000_000);
    assert_eq!(pool_withdrawn, 10_000_000_000);
    assert_eq!(s.lending.get_pool_balance(), 100_000_000);
    assert_eq!(s.lending.get_accrued_interest(), 100_000_000);

    // Ahora `withdraw_interest` retira el interés acumulado y exige auth de `treasury`
    let int_withdrawn = s.lending.withdraw_interest(&500_000_000);
    assert_eq!(
        s.env.auths().first().unwrap().0,
        s.treasury,
        "withdraw_interest debe requerir autorización de la tesorería"
    );
    let _ = (
        AuthorizedFunction::Contract((
            s.lending_addr.clone(),
            Symbol::new(&s.env, "withdraw_interest"),
            (500_000_000i128,).into_val(&s.env),
        )),
        AuthorizedInvocation {
            function: AuthorizedFunction::Contract((
                s.lending_addr,
                Symbol::new(&s.env, "withdraw_interest"),
                (500_000_000i128,).into_val(&s.env),
            )),
            sub_invocations: std::vec![],
        },
    );
    assert_eq!(int_withdrawn, 100_000_000);
    assert_eq!(s.lending.get_accrued_interest(), 0);
    assert_eq!(s.lending.get_pool_balance(), 0);

    let token_client = token::Client::new(&s.env, &s.token_addr);
    assert_eq!(token_client.balance(&s.treasury), 10_100_000_000);
}
