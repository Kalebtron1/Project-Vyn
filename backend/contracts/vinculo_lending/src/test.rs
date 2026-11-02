#![cfg(test)]
extern crate std;

use crate::{
    DataKey, Error, LoanConfig, LoanHistory, TierTerms, VinculoLending, VinculoLendingClient,
    TTL_EXTEND_TO,
};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{storage::Instance as _, storage::Persistent as _, Address as _, Ledger as _},
    token, vec, Address, Env, Symbol, Vec,
};
use staking_pool::{StakingContract, StakingContractClient, VaultAsset};
use vinculo_sbt::{ReputationConfig, TierRule, VinculoSBT, VinculoSBTClient};

const WASM: &[u8] = include_bytes!("../../target/wasm32v1-none/release/vinculo_lending.wasm");

const USDC: i128 = 10_000_000;
const MONTH: u64 = 2_592_000;
const GRACE: u64 = 604_800;
const START: u64 = 1_000;

#[contracttype]
enum MockKey {
    Tier(Address),
    Token,
    Rate,
    Shares(Address),
}

#[contract]
pub struct MockSbt;

#[contractimpl]
impl MockSbt {
    pub fn set_tier(env: Env, user: Address, tier: u32) {
        env.storage().persistent().set(&MockKey::Tier(user), &tier);
    }

    pub fn compute_tier(env: Env, user: Address, _history: LoanHistory) -> u32 {
        env.storage()
            .persistent()
            .get(&MockKey::Tier(user))
            .unwrap_or(0)
    }
}

#[contract]
pub struct MockVault;

#[contractimpl]
impl MockVault {
    pub fn __constructor(env: Env, token: Address) {
        env.storage().instance().set(&MockKey::Token, &token);
        env.storage().instance().set(&MockKey::Rate, &10_000i128);
    }

    pub fn set_rate(env: Env, bps: i128) {
        env.storage().instance().set(&MockKey::Rate, &bps);
    }

    fn rate(env: &Env) -> i128 {
        env.storage().instance().get(&MockKey::Rate).unwrap()
    }

    pub fn deposit(
        env: Env,
        amounts_desired: Vec<i128>,
        _amounts_min: Vec<i128>,
        from: Address,
        _invest: bool,
    ) -> i128 {
        from.require_auth();
        let amount = amounts_desired.get(0).unwrap();
        let token_addr: Address = env.storage().instance().get(&MockKey::Token).unwrap();
        token::Client::new(&env, &token_addr).transfer(
            &from,
            env.current_contract_address(),
            &amount,
        );
        let minted = amount * 10_000 / Self::rate(&env);
        let key = MockKey::Shares(from);
        let prev: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(prev + minted));
        minted
    }

    pub fn withdraw(
        env: Env,
        df_amount: i128,
        _min_amounts_out: Vec<i128>,
        from: Address,
    ) -> Vec<i128> {
        from.require_auth();
        let out = df_amount * Self::rate(&env) / 10_000;
        let key = MockKey::Shares(from.clone());
        let prev: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(prev - df_amount));
        let token_addr: Address = env.storage().instance().get(&MockKey::Token).unwrap();
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
        let token: Address = env.storage().instance().get(&MockKey::Token).unwrap();
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
            .get(&MockKey::Shares(id))
            .unwrap_or(0)
    }
}

fn config() -> LoanConfig {
    LoanConfig {
        apy_bps: 1_200,
        seconds_per_month: MONTH,
        grace_period: GRACE,
        plata: TierTerms {
            ltv_bps: 5_000,
            max_principal: 100 * USDC,
        },
        oro: TierTerms {
            ltv_bps: 6_000,
            max_principal: 250 * USDC,
        },
        diamante: TierTerms {
            ltv_bps: 7_000,
            max_principal: 750 * USDC,
        },
        platino: TierTerms {
            ltv_bps: 8_000,
            max_principal: 2_000 * USDC,
        },
    }
}

struct Setup {
    env: Env,
    id: Address,
    client: VinculoLendingClient<'static>,
    savings: StakingContractClient<'static>,
    savings_id: Address,
    vault: MockVaultClient<'static>,
    vault_id: Address,
    admin: Address,
    pauser: Address,
    treasury: Address,
    token_addr: Address,
    token_admin: token::StellarAssetClient<'static>,
    sbt: MockSbtClient<'static>,
    sbt_id: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().set_timestamp(START);

    let issuer = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(issuer).address();
    let token_admin = token::StellarAssetClient::new(&env, &token_addr);
    let vault_id = env.register(MockVault, (token_addr.clone(),));
    let vault = MockVaultClient::new(&env, &vault_id);
    let sbt_id = env.register(MockSbt, ());
    let sbt = MockSbtClient::new(&env, &sbt_id);

    let admin = Address::generate(&env);
    let pauser = Address::generate(&env);
    let treasury = Address::generate(&env);
    let savings_id = env.register(
        StakingContract,
        (
            admin.clone(),
            pauser.clone(),
            token_addr.clone(),
            vault_id.clone(),
            10 * USDC,
        ),
    );
    let savings = StakingContractClient::new(&env, &savings_id);
    let id = env.register(
        VinculoLending,
        (
            admin.clone(),
            pauser.clone(),
            savings_id.clone(),
            sbt_id.clone(),
            treasury.clone(),
            config(),
        ),
    );
    let client = VinculoLendingClient::new(&env, &id);
    savings.grant_role(&id, &Symbol::new(&env, "lending"), &admin);

    Setup {
        env,
        id,
        client,
        savings,
        savings_id,
        vault,
        vault_id,
        admin,
        pauser,
        treasury,
        token_addr,
        token_admin,
        sbt,
        sbt_id,
    }
}

impl Setup {
    fn fund(&self, amount: i128) {
        let funder = Address::generate(&self.env);
        self.token_admin.mint(&funder, &amount);
        self.client.fund_pool(&funder, &amount);
    }

    /// Usuario con un tier y ahorro en el contrato real.
    fn saver(&self, tier: u32, saved: i128) -> Address {
        let user = Address::generate(&self.env);
        self.sbt.set_tier(&user, &tier);
        if saved > 0 {
            self.token_admin.mint(&user, &saved);
            self.savings.deposit(&user, &saved);
        }
        user
    }

    fn balance(&self, who: &Address) -> i128 {
        token::Client::new(&self.env, &self.token_addr).balance(who)
    }

    fn at(&self, timestamp: u64) {
        self.env.ledger().set_timestamp(timestamp);
    }
}

// ─── Constructor y configuración ─────────────────────────────────────────────

#[test]
fn token_comes_from_savings_and_config_is_stored() {
    let s = setup();
    assert_eq!(s.client.get_config(), config());
    s.fund(10);
    assert_eq!(s.balance(&s.id), 10);
    assert_eq!(s.client.get_pool_balance(), 10);
}

#[test]
fn config_rejects_unsafe_values() {
    let s = setup();
    // Con 90% de LTV y 12% de APR, la deuda a 12 meses supera el colateral.
    let mut unsafe_ltv = config();
    unsafe_ltv.platino.ltv_bps = 9_000;
    assert_eq!(
        s.client.try_set_config(&unsafe_ltv),
        Err(Ok(Error::InvalidConfig))
    );

    let mut zero_apy = config();
    zero_apy.apy_bps = 0;
    assert_eq!(
        s.client.try_set_config(&zero_apy),
        Err(Ok(Error::InvalidConfig))
    );

    let mut zero_cap = config();
    zero_cap.oro.max_principal = 0;
    assert_eq!(
        s.client.try_set_config(&zero_cap),
        Err(Ok(Error::InvalidConfig))
    );

    let mut zero_ltv = config();
    zero_ltv.oro.ltv_bps = 0;
    assert_eq!(
        s.client.try_set_config(&zero_ltv),
        Err(Ok(Error::InvalidConfig))
    );

    let mut zero_month = config();
    zero_month.seconds_per_month = 0;
    assert_eq!(
        s.client.try_set_config(&zero_month),
        Err(Ok(Error::InvalidConfig))
    );
}

#[test]
#[should_panic]
fn constructor_rejects_unsafe_config() {
    let s = setup();
    let mut unsafe_ltv = config();
    unsafe_ltv.plata.ltv_bps = 9_500;
    s.env.register(
        VinculoLending,
        (
            s.admin.clone(),
            s.pauser.clone(),
            s.savings_id.clone(),
            s.sbt_id.clone(),
            s.treasury.clone(),
            unsafe_ltv,
        ),
    );
}

#[test]
fn set_config_needs_admin_and_keeps_active_loans() {
    let s = setup();
    s.fund(1_000 * USDC);
    let user = s.saver(1, 200 * USDC);
    s.client.request_loan(&user, &(100 * USDC), &12);
    let loan = s.client.get_loan(&user);

    let mut next = config();
    next.apy_bps = 600;
    next.grace_period = 1;
    s.env.set_auths(&[]);
    assert!(s.client.try_set_config(&next).is_err());

    s.env.mock_all_auths_allowing_non_root_auth();
    s.client.set_config(&next);
    assert_eq!(s.client.get_config(), next);
    assert_eq!(s.client.get_loan(&user), loan);
    assert_eq!(s.client.get_loan(&user).interest_due, 12 * USDC);
}

// ─── Pedir préstamos ─────────────────────────────────────────────────────────

#[test]
fn every_tier_uses_its_ltv_and_cap() {
    let s = setup();
    s.fund(10_000 * USDC);
    let cases = [
        (1, 100 * USDC, 200 * USDC),
        (2, 250 * USDC, 417 * USDC),
        (3, 750 * USDC, 1_072 * USDC),
        (4, 2_000 * USDC, 2_500 * USDC),
    ];
    for (tier, cap, saved) in cases {
        let user = s.saver(tier, saved);
        assert_eq!(s.client.get_max_principal(&user), cap);
        assert_eq!(
            s.client.try_request_loan(&user, &(cap + 1), &1),
            Err(Ok(Error::ExceedsTierLimit))
        );
        s.client.request_loan(&user, &cap, &1);
        assert_eq!(s.balance(&user), cap);
        assert_eq!(s.client.get_max_principal(&user), 0);
    }
}

#[test]
fn collateral_is_required_and_locked() {
    let s = setup();
    s.fund(1_000 * USDC);
    let user = s.saver(1, 150 * USDC);

    // 50% de LTV: 100 USDC necesitan 200 de ahorro y solo tiene 150.
    assert!(s.client.try_request_loan(&user, &(100 * USDC), &1).is_err());
    assert_eq!(s.client.get_max_principal(&user), 75 * USDC);

    s.client.request_loan(&user, &(50 * USDC), &1);
    assert_eq!(s.savings.get_free_position(&user), 50 * USDC);
    assert_eq!(
        s.savings.get_locked(&user),
        s.client.get_loan(&user).collateral_shares
    );
    assert_eq!(s.savings.withdraw(&user, &(150 * USDC), &0), 50 * USDC);
    assert_eq!(s.savings.get_position(&user), 100 * USDC);
}

#[test]
fn wallets_without_savings_cannot_drain_the_pool() {
    let s = setup();
    s.fund(1_000 * USDC);
    for _ in 0..5 {
        let sybil = s.saver(4, 0);
        assert!(s.client.try_request_loan(&sybil, &USDC, &1).is_err());
        assert_eq!(s.balance(&sybil), 0);
    }
    assert_eq!(s.client.get_pool_balance(), 1_000 * USDC);
}

#[test]
fn request_loan_validates_tier_term_amount_and_duplicates() {
    let s = setup();
    s.fund(1_000 * USDC);
    let bronce = s.saver(0, 500 * USDC);
    assert_eq!(
        s.client.try_request_loan(&bronce, &USDC, &1),
        Err(Ok(Error::NotEligible))
    );
    assert_eq!(s.client.get_max_principal(&bronce), 0);

    let user = s.saver(1, 500 * USDC);
    assert_eq!(
        s.client.try_request_loan(&user, &USDC, &2),
        Err(Ok(Error::InvalidTerm))
    );
    assert_eq!(
        s.client.try_request_loan(&user, &0, &1),
        Err(Ok(Error::InvalidAmount))
    );
    s.client.request_loan(&user, &USDC, &1);
    assert_eq!(
        s.client.try_request_loan(&user, &USDC, &1),
        Err(Ok(Error::ActiveLoan))
    );
}

#[test]
fn request_loan_needs_user_signature() {
    let s = setup();
    s.fund(1_000 * USDC);
    let user = s.saver(1, 500 * USDC);
    s.env.set_auths(&[]);
    assert!(s.client.try_request_loan(&user, &USDC, &1).is_err());
    assert_eq!(s.balance(&user), 0);
    assert_eq!(s.savings.get_locked(&user), 0);
}

#[test]
fn interest_is_simple_and_depends_on_term() {
    let s = setup();
    s.fund(10_000 * USDC);
    for (months, expected) in [(1, USDC), (3, 3 * USDC), (6, 6 * USDC), (12, 12 * USDC)] {
        let user = s.saver(1, 200 * USDC);
        let quote = s.client.quote(&user, &(100 * USDC), &months);
        assert_eq!(quote.interest, expected);
        assert_eq!(quote.required_collateral, 200 * USDC);
        s.client.request_loan(&user, &(100 * USDC), &months);
        let loan = s.client.get_loan(&user);
        assert_eq!(loan.interest_due, expected);
        assert_eq!(loan.total_owed, 100 * USDC + expected);
        assert_eq!(loan.due_timestamp, START + months * MONTH);
        assert_eq!(loan.liquidatable_at, START + months * MONTH + GRACE);
    }
}

#[test]
fn smallest_interest_rounds_up() {
    let s = setup();
    s.fund(1_000 * USDC);
    let user = s.saver(1, 200 * USDC);
    s.client.request_loan(&user, &1, &1);
    assert_eq!(s.client.get_loan(&user).interest_due, 1);
}

#[test]
fn loans_cannot_use_treasury_interest() {
    let s = setup();
    s.fund(100 * USDC);
    let first = s.saver(1, 200 * USDC);
    s.client.request_loan(&first, &(100 * USDC), &1);
    s.token_admin.mint(&first, &USDC);
    s.client.repay(&first, &(101 * USDC));
    assert_eq!(s.client.get_pool_balance(), 101 * USDC);

    let second = s.saver(1, 400 * USDC);
    assert_eq!(
        s.client.try_request_loan(&second, &(100 * USDC + 1), &1),
        Err(Ok(Error::ExceedsTierLimit))
    );
    let mut bigger = config();
    bigger.plata.max_principal = 200 * USDC;
    s.client.set_config(&bigger);
    assert_eq!(
        s.client.try_request_loan(&second, &(100 * USDC + 1), &1),
        Err(Ok(Error::InsufficientLiquidity))
    );
    s.client.request_loan(&second, &(100 * USDC), &1);
}

// ─── Pagar ───────────────────────────────────────────────────────────────────

#[test]
fn partial_payment_goes_to_interest_first() {
    let s = setup();
    s.fund(1_000 * USDC);
    let user = s.saver(1, 200 * USDC);
    s.client.request_loan(&user, &(100 * USDC), &12);

    s.client.repay(&user, &(5 * USDC));
    let loan = s.client.get_loan(&user);
    assert_eq!(loan.interest_due, 7 * USDC);
    assert_eq!(loan.principal_due, 100 * USDC);
    assert_eq!(s.client.get_accrued_interest(), 5 * USDC);
    assert_eq!(s.client.get_total_borrowed(), 100 * USDC);

    s.client.repay(&user, &(17 * USDC));
    let loan = s.client.get_loan(&user);
    assert_eq!(loan.interest_due, 0);
    assert_eq!(loan.principal_due, 90 * USDC);
    assert_eq!(s.client.get_accrued_interest(), 12 * USDC);
    assert_eq!(s.client.get_total_borrowed(), 90 * USDC);
    // Un pago parcial no libera colateral.
    assert_eq!(s.savings.get_free_position(&user), 0);
}

#[test]
fn full_repay_on_time_unlocks_and_counts() {
    let s = setup();
    s.fund(1_000 * USDC);
    let user = s.saver(1, 200 * USDC);
    s.client.request_loan(&user, &(100 * USDC), &1);
    s.token_admin.mint(&user, &USDC);

    s.at(START + MONTH);
    // Pagar de más solo cobra lo que se debe.
    s.client.repay(&user, &(500 * USDC));
    assert_eq!(s.balance(&user), 0);
    assert_eq!(s.client.get_loan(&user).total_owed, 0);
    assert_eq!(s.savings.get_locked(&user), 0);
    assert_eq!(s.savings.get_free_position(&user), 200 * USDC);
    assert_eq!(s.client.get_total_borrowed(), 0);
    assert_eq!(s.client.get_pool_balance(), 1_001 * USDC);
    assert_eq!(
        s.client.get_history(&user),
        LoanHistory {
            repaid_on_time: 1,
            ..LoanHistory::default()
        }
    );
    assert_eq!(s.client.try_repay(&user, &1), Err(Ok(Error::NoActiveLoan)));
    // Puede volver a pedir.
    s.client.request_loan(&user, &USDC, &1);
}

#[test]
fn repay_after_due_counts_as_late_without_penalty() {
    let s = setup();
    s.fund(1_000 * USDC);
    let user = s.saver(1, 200 * USDC);
    s.client.request_loan(&user, &(100 * USDC), &1);
    s.token_admin.mint(&user, &USDC);

    s.at(START + MONTH + 1);
    s.client.repay(&user, &(101 * USDC));
    let history = s.client.get_history(&user);
    assert_eq!(history.repaid_late, 1);
    assert_eq!(history.repaid_on_time, 0);
    assert_eq!(history.defaults, 0);
    assert_eq!(s.savings.get_free_position(&user), 200 * USDC);
}

#[test]
fn nobody_else_can_repay_with_user_funds() {
    let s = setup();
    s.fund(1_000 * USDC);
    let user = s.saver(1, 200 * USDC);
    s.client.request_loan(&user, &(100 * USDC), &1);
    s.env.set_auths(&[]);
    assert!(s.client.try_repay(&user, &USDC).is_err());
    assert_eq!(s.balance(&user), 100 * USDC);
}

// ─── Liquidar ────────────────────────────────────────────────────────────────

#[test]
fn cannot_liquidate_before_grace_ends() {
    let s = setup();
    s.fund(1_000 * USDC);
    let user = s.saver(1, 200 * USDC);
    s.client.request_loan(&user, &(100 * USDC), &1);

    for timestamp in [START, START + MONTH, START + MONTH + GRACE - 1] {
        s.at(timestamp);
        assert!(!s.client.is_liquidatable(&user));
        assert_eq!(
            s.client.try_liquidate(&user),
            Err(Ok(Error::NotLiquidatable))
        );
    }
    assert_eq!(s.savings.get_position(&user), 200 * USDC);
}

#[test]
fn liquidate_needs_active_loan() {
    let s = setup();
    let user = s.saver(1, 200 * USDC);
    assert_eq!(s.client.try_liquidate(&user), Err(Ok(Error::NoActiveLoan)));
}

#[test]
fn liquidation_covers_debt_and_frees_the_rest_without_a_signature() {
    let s = setup();
    s.fund(1_000 * USDC);
    let user = s.saver(1, 300 * USDC);
    s.client.request_loan(&user, &(100 * USDC), &1);

    s.at(START + MONTH + GRACE);
    assert!(s.client.is_liquidatable(&user));
    s.env.set_auths(&[]);
    assert_eq!(s.client.liquidate(&user), 101 * USDC);
    s.env.mock_all_auths_allowing_non_root_auth();

    // El pool recupera todo: principal e interés.
    assert_eq!(s.client.get_pool_balance(), 1_001 * USDC);
    assert_eq!(s.client.get_accrued_interest(), USDC);
    assert_eq!(s.client.get_total_borrowed(), 0);
    assert_eq!(s.client.get_bad_debt(), 0);
    // El usuario conserva el préstamo y lo que sobra de su ahorro, ya libre.
    assert_eq!(s.balance(&user), 100 * USDC);
    assert_eq!(s.savings.get_locked(&user), 0);
    assert_eq!(s.savings.get_position(&user), 199 * USDC);
    assert_eq!(s.savings.get_free_position(&user), 199 * USDC);
    assert_eq!(s.client.get_loan(&user).total_owed, 0);

    let history = s.client.get_history(&user);
    assert_eq!(history.defaults, 1);
    assert_eq!(history.last_default_at, START + MONTH + GRACE);
    assert_eq!(s.client.try_liquidate(&user), Err(Ok(Error::NoActiveLoan)));
}

#[test]
fn default_does_not_touch_other_savers() {
    let s = setup();
    s.fund(1_000 * USDC);
    let saver = s.saver(0, 500 * USDC);
    let debtor = s.saver(1, 200 * USDC);
    s.client.request_loan(&debtor, &(100 * USDC), &1);
    s.at(START + MONTH + GRACE);
    s.client.liquidate(&debtor);
    assert_eq!(s.savings.get_position(&saver), 500 * USDC);
    assert_eq!(s.savings.withdraw(&saver, &(500 * USDC), &0), 500 * USDC);
}

#[test]
fn savings_yield_stays_with_the_user_after_default() {
    let s = setup();
    s.fund(1_000 * USDC);
    let user = s.saver(1, 200 * USDC);
    s.client.request_loan(&user, &(100 * USDC), &1);
    s.token_admin.mint(&s.vault_id, &(100 * USDC));
    s.vault.set_rate(&11_000);

    s.at(START + MONTH + GRACE);
    assert_eq!(s.client.liquidate(&user), 101 * USDC);
    let left = s.savings.get_free_position(&user);
    assert!(
        (119 * USDC - 2..=119 * USDC).contains(&left),
        "quedó {left}"
    );
    assert_eq!(s.client.get_bad_debt(), 0);
}

#[test]
fn vault_loss_is_recorded_as_bad_debt() {
    let s = setup();
    s.fund(1_000 * USDC);
    let user = s.saver(4, 125 * USDC);
    s.client.request_loan(&user, &(100 * USDC), &12);
    assert_eq!(s.client.get_loan(&user).total_owed, 112 * USDC);

    // El vault pierde la mitad: el colateral vale 62.5 y se deben 112.
    s.vault.set_rate(&5_000);
    s.at(START + 12 * MONTH + GRACE);
    let recovered = s.client.liquidate(&user);
    assert_eq!(recovered, 625 * USDC / 10);

    // Primero se cubre el interés; falta 49.5 de principal.
    assert_eq!(s.client.get_accrued_interest(), 12 * USDC);
    assert_eq!(s.client.get_bad_debt(), 495 * USDC / 10);
    assert_eq!(s.client.get_total_borrowed(), 0);
    assert_eq!(s.savings.get_locked(&user), 0);
    assert_eq!(s.savings.get_position(&user), 0);
    assert_eq!(s.client.get_history(&user).defaults, 1);
    assert_eq!(s.client.get_loan(&user).total_owed, 0);
}

#[test]
fn collateral_survives_a_vault_loss_within_the_margin() {
    let s = setup();
    s.fund(1_000 * USDC);
    let user = s.saver(4, 125 * USDC);
    s.client.request_loan(&user, &(100 * USDC), &12);

    // 10% de pérdida: 112.5 de colateral contra 112 de deuda.
    s.vault.set_rate(&9_000);
    s.at(START + 12 * MONTH + GRACE);
    assert_eq!(s.client.liquidate(&user), 112 * USDC);
    assert_eq!(s.client.get_bad_debt(), 0);
}

// ─── Tesorería ───────────────────────────────────────────────────────────────

#[test]
fn treasury_withdrawals_need_its_signature_and_respect_limits() {
    let s = setup();
    s.fund(100 * USDC);
    let user = s.saver(1, 200 * USDC);
    s.client.request_loan(&user, &(100 * USDC), &1);
    assert_eq!(
        s.client.try_withdraw_pool(&USDC),
        Err(Ok(Error::NothingToWithdraw))
    );
    s.token_admin.mint(&user, &USDC);
    s.client.repay(&user, &(101 * USDC));

    s.env.set_auths(&[]);
    assert!(s.client.try_withdraw_interest(&10).is_err());
    assert!(s.client.try_withdraw_pool(&10).is_err());

    s.env.mock_all_auths_allowing_non_root_auth();
    assert_eq!(
        s.client.try_withdraw_interest(&0),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(s.client.withdraw_pool(&(10_000 * USDC)), 100 * USDC);
    assert_eq!(s.balance(&s.treasury), 100 * USDC);
    assert_eq!(s.client.get_pool_balance(), USDC);
    assert_eq!(s.client.withdraw_interest(&(10_000 * USDC)), USDC);
    assert_eq!(s.balance(&s.treasury), 101 * USDC);
    assert_eq!(
        s.client.try_withdraw_interest(&1),
        Err(Ok(Error::NothingToWithdraw))
    );
}

#[test]
fn set_treasury_needs_admin_and_new_treasury() {
    let s = setup();
    let next = Address::generate(&s.env);
    s.env.set_auths(&[]);
    assert!(s.client.try_set_treasury(&next).is_err());
    assert_eq!(s.client.get_treasury(), s.treasury);

    s.env.mock_all_auths_allowing_non_root_auth();
    s.client.set_treasury(&next);
    assert_eq!(s.client.get_treasury(), next);
}

// ─── Pausa, TTL y upgrade ────────────────────────────────────────────────────

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
    s.env.mock_all_auths_allowing_non_root_auth();
    s.client.unpause(&s.admin);
    assert!(!s.client.paused());
}

#[test]
fn pause_blocks_loans_liquidations_and_treasury_but_never_repay() {
    let s = setup();
    s.fund(1_000 * USDC);
    let user = s.saver(1, 200 * USDC);
    s.client.request_loan(&user, &(100 * USDC), &1);
    s.client.pause(&s.pauser);

    let other = s.saver(1, 200 * USDC);
    assert!(s.client.try_request_loan(&other, &USDC, &1).is_err());
    assert!(s.client.try_withdraw_pool(&10).is_err());
    assert!(s.client.try_withdraw_interest(&10).is_err());
    s.at(START + MONTH + GRACE);
    assert!(s.client.try_liquidate(&user).is_err());

    s.token_admin.mint(&user, &USDC);
    s.client.repay(&user, &(101 * USDC));
    assert_eq!(s.client.get_loan(&user).total_owed, 0);
    assert_eq!(s.savings.get_free_position(&user), 200 * USDC);
}

#[test]
fn repay_unlocks_collateral_even_if_savings_is_paused() {
    let s = setup();
    s.fund(1_000 * USDC);
    let user = s.saver(1, 200 * USDC);
    s.client.request_loan(&user, &(100 * USDC), &1);
    s.savings.pause(&s.pauser);
    s.token_admin.mint(&user, &USDC);
    s.client.repay(&user, &(101 * USDC));
    assert_eq!(s.savings.withdraw(&user, &(200 * USDC), &0), 200 * USDC);
}

#[test]
fn writes_extend_ttl() {
    let s = setup();
    s.fund(1_000 * USDC);
    let user = s.saver(1, 200 * USDC);
    s.client.request_loan(&user, &(100 * USDC), &1);
    s.env.as_contract(&s.id, || {
        let key = DataKey::Loan(user.clone());
        assert_eq!(s.env.storage().persistent().get_ttl(&key), TTL_EXTEND_TO);
        assert_eq!(s.env.storage().instance().get_ttl(), TTL_EXTEND_TO);
    });

    s.token_admin.mint(&user, &USDC);
    s.client.repay(&user, &(101 * USDC));
    s.env.as_contract(&s.id, || {
        let key = DataKey::History(user.clone());
        assert_eq!(s.env.storage().persistent().get_ttl(&key), TTL_EXTEND_TO);
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
            s.sbt_id.clone(),
            s.treasury.clone(),
            config(),
        ),
    );
    let client = VinculoLendingClient::new(&s.env, &id);
    let hash = s.env.deployer().upload_contract_wasm(WASM);

    s.env.set_auths(&[]);
    assert!(client.try_upgrade(&hash, &s.treasury).is_err());

    s.env.mock_all_auths_allowing_non_root_auth();
    client.upgrade(&hash, &s.admin);
    assert_eq!(client.get_treasury(), s.treasury);
    assert_eq!(client.get_config(), config());
    assert_eq!(client.get_admin(), Some(s.admin.clone()));
    client.upgrade(&hash, &s.admin);
}

// ─── Deuda sin cubrir ────────────────────────────────────────────────────────

#[test]
fn uncovered_debt_can_be_paid_later() {
    let s = setup();
    s.fund(1_000 * USDC);
    let user = s.saver(4, 125 * USDC);
    s.client.request_loan(&user, &(100 * USDC), &12);
    s.vault.set_rate(&5_000);
    s.at(START + 12 * MONTH + GRACE);
    s.client.liquidate(&user);
    assert_eq!(s.client.get_history(&user).unpaid_debt, 495 * USDC / 10);
    let pool = s.client.get_pool_balance();

    s.env.set_auths(&[]);
    assert!(s.client.try_repay_bad_debt(&user, &USDC).is_err());
    s.env.mock_all_auths_allowing_non_root_auth();

    assert_eq!(s.client.repay_bad_debt(&user, &(10 * USDC)), 10 * USDC);
    assert_eq!(s.client.get_bad_debt(), 395 * USDC / 10);
    assert_eq!(s.client.get_pool_balance(), pool + 10 * USDC);

    // Pagar de más solo cobra lo que se debe.
    assert_eq!(
        s.client.repay_bad_debt(&user, &(90 * USDC)),
        395 * USDC / 10
    );
    assert_eq!(s.client.get_bad_debt(), 0);
    assert_eq!(s.client.get_history(&user).unpaid_debt, 0);
    assert_eq!(
        s.client.try_repay_bad_debt(&user, &1),
        Err(Ok(Error::NoActiveLoan))
    );
}

// ─── Flujo completo con el SBT real ──────────────────────────────────────────

const DAY: u64 = 86_400;

fn tier_rule(usdc: i128, days: u64, deposits: u32, on_time: u32, allow_defaults: bool) -> TierRule {
    TierRule {
        min_balance: usdc * USDC,
        min_seconds: days * DAY,
        min_valid_deposits: deposits,
        min_repaid_on_time: on_time,
        allow_defaults,
    }
}

struct Full {
    s: Setup,
    sbt: VinculoSBTClient<'static>,
    lending: VinculoLendingClient<'static>,
}

fn full_setup() -> Full {
    let s = setup();
    let reputation = ReputationConfig {
        plata: tier_rule(10, 30, 3, 0, true),
        oro: tier_rule(50, 90, 3, 1, true),
        diamante: tier_rule(200, 180, 3, 3, false),
        platino: tier_rule(1_000, 365, 3, 6, false),
        default_cooldown: 90 * DAY,
    };
    let mut uris = soroban_sdk::vec![&s.env];
    for name in ["bronce", "plata", "oro", "diamante", "platino"] {
        uris.push_back(soroban_sdk::String::from_str(&s.env, name));
    }
    let sbt_id = s.env.register(
        VinculoSBT,
        (
            s.admin.clone(),
            s.pauser.clone(),
            s.savings_id.clone(),
            reputation,
            uris,
        ),
    );
    let sbt = VinculoSBTClient::new(&s.env, &sbt_id);
    let lending_id = s.env.register(
        VinculoLending,
        (
            s.admin.clone(),
            s.pauser.clone(),
            s.savings_id.clone(),
            sbt_id,
            s.treasury.clone(),
            config(),
        ),
    );
    let lending = VinculoLendingClient::new(&s.env, &lending_id);
    sbt.set_lending(&lending_id);
    s.savings
        .grant_role(&lending_id, &Symbol::new(&s.env, "lending"), &s.admin);

    let funder = Address::generate(&s.env);
    s.token_admin.mint(&funder, &(10_000 * USDC));
    lending.fund_pool(&funder, &(10_000 * USDC));
    Full { s, sbt, lending }
}

impl Full {
    fn saver(&self, deposits: u32, each: i128) -> Address {
        let user = Address::generate(&self.s.env);
        self.s
            .token_admin
            .mint(&user, &(i128::from(deposits) * each));
        for _ in 0..deposits {
            self.s.savings.deposit(&user, &each);
        }
        user
    }
}

#[test]
fn new_saver_cannot_borrow_until_the_time_passes() {
    let f = full_setup();
    let user = f.saver(3, 10 * USDC);
    assert_eq!(f.sbt.preview_tier(&user), 0);
    assert_eq!(
        f.lending.try_request_loan(&user, &USDC, &1),
        Err(Ok(Error::NotEligible))
    );

    f.s.at(START + 30 * DAY - 1);
    assert_eq!(f.lending.get_max_principal(&user), 0);

    f.s.at(START + 30 * DAY);
    assert_eq!(f.sbt.preview_tier(&user), 1);
    assert_eq!(f.lending.get_max_principal(&user), 15 * USDC);
    f.lending.request_loan(&user, &(15 * USDC), &1);
    assert_eq!(f.s.balance(&user), 15 * USDC);
}

#[test]
fn many_tiny_deposits_never_unlock_credit() {
    let f = full_setup();
    let spammer = f.saver(31, USDC / 10);
    f.s.at(START + 365 * DAY);
    assert_eq!(f.sbt.refresh_tier(&spammer), 0);
    assert_eq!(f.lending.get_max_principal(&spammer), 0);
}

#[test]
fn repaying_on_time_raises_the_tier() {
    let f = full_setup();
    let user = f.saver(3, 50 * USDC);
    f.s.at(START + 90 * DAY);
    assert_eq!(f.sbt.refresh_tier(&user), 1);

    f.lending.request_loan(&user, &(50 * USDC), &1);
    f.s.token_admin.mint(&user, &USDC);
    f.lending.repay(&user, &(51 * USDC));
    assert_eq!(f.lending.get_history(&user).repaid_on_time, 1);
    assert_eq!(f.sbt.refresh_tier(&user), 2);
    assert_eq!(f.sbt.get_tier(&user), 2);
    assert_eq!(f.lending.get_max_principal(&user), 90 * USDC);
}

#[test]
fn default_closes_credit_for_the_cooldown_even_without_refresh() {
    let f = full_setup();
    let user = f.saver(3, 10 * USDC);
    f.s.at(START + 30 * DAY);
    f.sbt.refresh_tier(&user);
    f.lending.request_loan(&user, &(10 * USDC), &1);

    let default_at = START + 30 * DAY + MONTH + GRACE;
    f.s.at(default_at);
    f.lending.liquidate(&user);

    // El nivel guardado sigue viejo, pero el crédito usa el vigente.
    assert_eq!(f.sbt.get_tier(&user), 1);
    assert_eq!(
        f.lending.try_request_loan(&user, &USDC, &1),
        Err(Ok(Error::NotEligible))
    );
    assert_eq!(f.sbt.refresh_tier(&user), 0);

    f.s.at(default_at + 90 * DAY);
    assert_eq!(f.sbt.preview_tier(&user), 1);
    f.lending.request_loan(&user, &USDC, &1);
}

#[test]
fn withdrawing_savings_lowers_credit_immediately() {
    let f = full_setup();
    let user = f.saver(3, 10 * USDC);
    f.s.at(START + 30 * DAY);
    assert_eq!(f.lending.get_max_principal(&user), 15 * USDC);
    f.s.savings.withdraw(&user, &(25 * USDC), &0);
    assert_eq!(f.sbt.preview_tier(&user), 0);
    assert_eq!(f.lending.get_max_principal(&user), 0);
}
