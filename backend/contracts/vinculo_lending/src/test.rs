#![cfg(test)]
extern crate std;

use crate::{DataKey, VinculoLending, VinculoLendingClient, TTL_EXTEND_TO};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{storage::Instance as _, storage::Persistent as _, Address as _},
    token, Address, Env,
};

const WASM: &[u8] = include_bytes!("../../target/wasm32v1-none/release/vinculo_lending.wasm");

#[contracttype]
enum MockKey {
    Tier(Address),
}

#[contract]
pub struct MockSbt;

#[contractimpl]
impl MockSbt {
    pub fn set_tier(env: Env, user: Address, tier: u32) {
        env.storage().persistent().set(&MockKey::Tier(user), &tier);
    }

    pub fn get_tier(env: Env, user: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&MockKey::Tier(user))
            .unwrap_or(0)
    }
}

struct Setup {
    env: Env,
    id: Address,
    client: VinculoLendingClient<'static>,
    admin: Address,
    pauser: Address,
    treasury: Address,
    token_addr: Address,
    token_admin: token::StellarAssetClient<'static>,
    sbt: MockSbtClient<'static>,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    let issuer = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(issuer).address();
    let token_admin = token::StellarAssetClient::new(&env, &token_addr);
    let sbt_addr = env.register(MockSbt, ());
    let sbt = MockSbtClient::new(&env, &sbt_addr);
    let admin = Address::generate(&env);
    let pauser = Address::generate(&env);
    let treasury = Address::generate(&env);
    let id = env.register(
        VinculoLending,
        (
            admin.clone(),
            pauser.clone(),
            token_addr.clone(),
            sbt_addr,
            treasury.clone(),
        ),
    );
    let client = VinculoLendingClient::new(&env, &id);
    Setup {
        env,
        id,
        client,
        admin,
        pauser,
        treasury,
        token_addr,
        token_admin,
        sbt,
    }
}

impl Setup {
    fn fund(&self, amount: i128) {
        let funder = Address::generate(&self.env);
        self.token_admin.mint(&funder, &amount);
        self.client.fund_pool(&funder, &amount);
    }

    fn borrower(&self, tier: u32) -> Address {
        let user = Address::generate(&self.env);
        self.sbt.set_tier(&user, &tier);
        user
    }

    fn balance(&self, who: &Address) -> i128 {
        token::Client::new(&self.env, &self.token_addr).balance(who)
    }
}

#[test]
fn request_loan_needs_valid_tier_term_and_limit() {
    let s = setup();
    s.fund(100_000_000_000);
    let bronce = s.borrower(0);
    assert!(s.client.try_request_loan(&bronce, &1_000, &1).is_err());

    let plata = s.borrower(1);
    assert!(s.client.try_request_loan(&plata, &1_000, &2).is_err());
    assert!(s.client.try_request_loan(&plata, &0, &1).is_err());
    assert!(s
        .client
        .try_request_loan(&plata, &3_000_000_001, &1)
        .is_err());

    s.client.request_loan(&plata, &3_000_000_000, &1);
    assert_eq!(s.balance(&plata), 3_000_000_000);
}

#[test]
fn request_loan_needs_user_signature() {
    let s = setup();
    s.fund(10_000);
    let user = s.borrower(1);
    s.env.set_auths(&[]);
    assert!(s.client.try_request_loan(&user, &1_000, &1).is_err());
    assert_eq!(s.balance(&user), 0);
}

#[test]
fn only_one_active_loan_per_user() {
    let s = setup();
    s.fund(10_000);
    let user = s.borrower(1);
    s.client.request_loan(&user, &1_000, &1);
    assert!(s.client.try_request_loan(&user, &1_000, &1).is_err());
}

#[test]
fn partial_and_full_repay_move_interest_to_treasury_balance() {
    let s = setup();
    s.fund(10_000);
    let user = s.borrower(1);
    s.client.request_loan(&user, &1_000, &1);
    assert_eq!(s.client.get_loan(&user).total_owed, 1_050);

    s.token_admin.mint(&user, &50);
    s.client.repay(&user, &400);
    assert_eq!(s.client.get_loan(&user).total_owed, 650);
    assert_eq!(s.client.get_accrued_interest(), 0);

    // Pagar de más solo cobra lo que se debe.
    s.client.repay(&user, &5_000);
    assert_eq!(s.client.get_loan(&user).total_owed, 0);
    assert_eq!(s.client.get_accrued_interest(), 50);
    assert_eq!(s.balance(&user), 0);
    assert_eq!(s.client.get_pool_balance(), 10_050);
    assert!(s.client.try_repay(&user, &1).is_err());
}

#[test]
fn loans_cannot_use_treasury_interest() {
    let s = setup();
    s.fund(1_000);
    let first = s.borrower(1);
    s.client.request_loan(&first, &1_000, &1);
    s.token_admin.mint(&first, &50);
    s.client.repay(&first, &1_050);
    assert_eq!(s.client.get_pool_balance(), 1_050);

    let second = s.borrower(1);
    assert!(s.client.try_request_loan(&second, &1_050, &1).is_err());
    s.client.request_loan(&second, &1_000, &1);
}

#[test]
fn treasury_withdrawals_need_its_signature_and_respect_limits() {
    let s = setup();
    s.fund(1_000);
    let user = s.borrower(1);
    s.client.request_loan(&user, &1_000, &1);
    s.token_admin.mint(&user, &50);
    s.client.repay(&user, &1_050);

    s.env.set_auths(&[]);
    assert!(s.client.try_withdraw_interest(&10).is_err());
    assert!(s.client.try_withdraw_pool(&10).is_err());

    s.env.mock_all_auths();
    assert_eq!(s.client.withdraw_pool(&99_999), 1_000);
    assert_eq!(s.balance(&s.treasury), 1_000);
    assert_eq!(s.client.get_pool_balance(), 50);
    assert_eq!(s.client.withdraw_interest(&99_999), 50);
    assert_eq!(s.balance(&s.treasury), 1_050);
    assert!(s.client.try_withdraw_interest(&1).is_err());
}

#[test]
fn set_treasury_needs_admin_and_new_treasury() {
    let s = setup();
    let next = Address::generate(&s.env);
    s.env.set_auths(&[]);
    assert!(s.client.try_set_treasury(&next).is_err());
    assert_eq!(s.client.get_treasury(), s.treasury);

    s.env.mock_all_auths();
    s.client.set_treasury(&next);
    assert_eq!(s.client.get_treasury(), next);
}

#[test]
fn only_pauser_pauses_and_only_admin_unpauses() {
    let s = setup();
    let stranger = Address::generate(&s.env);
    assert!(s.client.try_pause(&stranger).is_err());
    assert!(s.client.try_pause(&s.admin).is_err());

    s.client.pause(&s.pauser);
    assert!(s.client.paused());

    s.env.set_auths(&[]);
    assert!(s.client.try_unpause(&s.pauser).is_err());
    s.env.mock_all_auths();
    s.client.unpause(&s.admin);
    assert!(!s.client.paused());
}

#[test]
fn pause_blocks_new_loans_and_treasury_but_never_repay() {
    let s = setup();
    s.fund(10_000);
    let user = s.borrower(1);
    s.client.request_loan(&user, &1_000, &1);
    s.client.pause(&s.pauser);

    let other = s.borrower(1);
    assert!(s.client.try_request_loan(&other, &1_000, &1).is_err());
    assert!(s.client.try_withdraw_pool(&10).is_err());
    assert!(s.client.try_withdraw_interest(&10).is_err());

    s.token_admin.mint(&user, &50);
    s.client.repay(&user, &1_050);
    assert_eq!(s.client.get_loan(&user).total_owed, 0);
}

#[test]
fn writes_extend_ttl() {
    let s = setup();
    s.fund(10_000);
    let user = s.borrower(1);
    s.client.request_loan(&user, &1_000, &1);
    s.env.as_contract(&s.id, || {
        let key = DataKey::Loan(user.clone());
        assert_eq!(s.env.storage().persistent().get_ttl(&key), TTL_EXTEND_TO);
        assert_eq!(s.env.storage().instance().get_ttl(), TTL_EXTEND_TO);
    });
}

#[test]
fn upgrade_requires_admin_and_keeps_state() {
    let env = Env::default();
    env.mock_all_auths();
    let issuer = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(issuer).address();
    let sbt = Address::generate(&env);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let id = env.register(
        WASM,
        (
            admin.clone(),
            admin.clone(),
            token_addr,
            sbt,
            treasury.clone(),
        ),
    );
    let client = VinculoLendingClient::new(&env, &id);
    let hash = env.deployer().upload_contract_wasm(WASM);

    env.set_auths(&[]);
    assert!(client.try_upgrade(&hash, &treasury).is_err());

    env.mock_all_auths();
    client.upgrade(&hash, &admin);
    assert_eq!(client.get_treasury(), treasury);
    assert_eq!(client.get_admin(), Some(admin.clone()));
    client.upgrade(&hash, &admin);
}
