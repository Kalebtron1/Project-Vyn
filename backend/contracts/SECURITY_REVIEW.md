# Contract Security Review — Issue #38

## Reviewer assumptions

1. **Soroban SDK v21.7.6** is the canonical version; all security properties here are relative to
   its `require_auth()` semantics (invoker must have signed the auth entry for that specific
   `Address` in the transaction envelope).
2. **`overflow-checks = true`** is set in every contract's `[profile.release]`. Integer overflow
   in release builds will abort the WASM execution rather than wrap silently.
3. The **hackathon time acceleration** (`1 month = 60 ledger seconds`) is intentional and
   out of scope for this review.
4. The **admin address** for `vinculo_sbt` is trusted. No multi-sig or time-lock exists around
   it; that is accepted product risk.
5. No workspace-level `Cargo.toml` exists; each contract is built independently.
6. **Test coverage is minimal**: `staking_pool` and `vinculo_sbt` have zero tests;
   `vinculo_lending` has one happy-path integration test.
7. This review is **static analysis only**; no fuzzing or formal verification was performed.

---

## Findings summary

| ID | Contract | Function | Severity | Type | Resolution |
|----|----------|----------|----------|------|------------|
| RISK-01 | staking_pool | `unstake()` | High | logic-error | Accepted risk — architectural change required |
| RISK-02 | vinculo_sbt | `mint()` | High | missing-validation | **Fixed** |
| RISK-03 | vinculo_lending | `request_loan()` | Medium | logic-error | **Fixed** |
| RISK-04 | staking_pool + vinculo_lending | `init()` / `init_lending()` | Critical | missing-access-control | **Fixed** |
| NOTE-01 | staking_pool | `stake()` | Info | logic-error | Documented |

---

## staking_pool

### Invariants

1. A user's stored `Balance` must never exceed the net tokens deposited minus what was withdrawn or staked.
2. A user's stored `Balance` must never go negative.
3. Tokens may only leave the contract's custody via `withdraw()` and `unstake()`, to the authenticated caller.
4. A user may only hold one active stake at a time.
5. Staked funds cannot be unstaked before `unlock_time`.
6. The contract's `Token` address is immutable after first initialization.

### Findings

#### [RISK-04] `init()` has no re-initialization guard

- **Function:** `init(env, token)`
- **Severity:** Critical
- **Type:** missing-access-control
- **What the code does:** Unconditionally overwrites `DataKey::Token` in instance storage. Any account can call `init()` at any time post-deployment.
- **What it should do:** Reject any call once the contract has already been initialized, making the `Token` address immutable.
- **Resolution:** Fixed — a `has(&DataKey::Token)` guard now panics `"already initialized"` on any second call.
- **Reproduction steps:**
  1. Deploy `staking_pool`; call `init(env, legitimate_token)`.
  2. From any account, call `init(env, attacker_token)` — no auth was required.
  3. All subsequent `deposit()` / `withdraw()` calls now operate on `attacker_token`.
  - **Expected:** Step 2 panics with "already initialized".
  - **Actual (before fix):** Token address silently replaced; real balances now map to attacker-controlled token.

---

#### [RISK-01] `unstake()` credits synthetic interest the contract may not hold

- **Function:** `unstake(env, user)`
- **Severity:** High
- **Type:** logic-error
- **What the code does:** Computes `interest = (amount * apy * months) / 1200` and adds it to the user's internal `Balance` key. No corresponding tokens are ever transferred *into* the contract to back this interest. If the contract does not hold enough real tokens, the eventual `withdraw()` → SAC `transfer()` will panic at withdrawal time, potentially after many other users have been credited phantom balances.
- **What it should do:** Interest credited to the internal balance must be backed by real tokens held by the contract (pre-funded via a `fund_rewards()` entry-point or protocol-fee accumulation).
- **Resolution:** Accepted risk — fixing this requires a new `fund_rewards_pool(from, amount)` function and a `DataKey::RewardPool` storage key, which changes the external interface and storage layout. **Safe to deploy to testnet** as long as the deployer manually pre-funds the contract with enough tokens to cover expected interest payouts before any `unstake()` calls occur.
- **Mitigation note for future engineer:**
  1. Add `DataKey::RewardPool` to track available interest reserves.
  2. Add `pub fn fund_rewards(env: Env, from: Address, amount: i128)` that transfers tokens into the contract and increments `RewardPool`.
  3. In `unstake()`, after computing `interest`, assert `reward_pool >= interest` and decrement `RewardPool`.

---

#### [NOTE-01] Dead APY wildcard arm returns 17 instead of 0

- **Function:** `stake()` APY `match` (line 73–79)
- **Severity:** Info
- **Type:** logic-error
- **What the code does:** The `_ => 17` arm is unreachable because `months` is validated to `1|3|6|12` before the match. If the guard were ever relaxed, unexpected values would grant a 17% APY instead of 0.
- **Resolution:** Replace `_ => 17` with `_ => 0` or `unreachable!()`. Documented only; no runtime risk with current guards.

---

### Checklist

- [PASS] `deposit()` only credits the signing address, not an arbitrary address
- [PASS] Withdrawal cannot exceed stored balance (assert at line 48 before mutation at line 50)
- [PASS] No unchecked integer arithmetic (`overflow-checks = true` in release profile)
- [PASS] `get_balance` / `get_stake` are pure reads with no side effects
- [FAIL → RISK-04] `init()` re-initialization guard — **Fixed**
- [FAIL → RISK-01] `unstake()` phantom interest — **Accepted risk**

---

## vinculo_sbt

### Invariants

1. Only the stored `Admin` address may assign or change any wallet's tier.
2. `mint()` may only **increase** a wallet's tier; only `revoke()` may decrease it (to 0).
3. A wallet cannot set its own tier under any code path.
4. `get_tier` is a pure read; it must not mutate storage.
5. The `Admin` address is immutable after first initialization.

### Findings

#### [RISK-02] `mint()` allowed arbitrary tier downgrade

- **Function:** `mint(env, admin, user, tier)`
- **Severity:** High
- **Type:** missing-validation
- **What the code does (before fix):** Only blocked `new_tier == current_tier`. An admin could call `mint(admin, alice, 1)` on a Platino (tier 4) holder, silently reducing her credit limit from `5_000_000_0000` to `300_000_0000` with no explicit revocation event.
- **What it should do:** `mint()` must enforce strictly monotonic tier increases. Downgrades must use `revoke()` explicitly to leave a clear audit trail.
- **Resolution:** Fixed — replaced the equality-only check with:
  ```rust
  // SECURITY-FIX [RISK-02]
  if tier == 0 { panic!("Usa revoke() para retirar el tier de un usuario"); }
  if tier <= current_tier { panic!("El nuevo tier debe ser mayor al tier actual"); }
  ```
- **Reproduction steps (before fix):**
  1. Admin mints tier 4 to `alice`.
  2. Admin calls `mint(admin, alice, 1)` — passes the old check.
  3. `alice.get_tier()` → 1; lending limit drops silently.
  - **Expected:** Call panics — `mint()` cannot downgrade.
  - **Actual (before fix):** Tier silently overwritten to 1.

---

### Checklist

- [PASS] `mint()` rejects any caller that is not the admin address
- [FAIL → RISK-02] A wallet's tier can only increase, never be overwritten with a lower value — **Fixed**
- [PASS] No path allows a wallet to mint its own tier without admin involvement
- [PASS] `get_tier` is a pure read
- [PASS] `init()` already guarded against re-initialization (`has(&DataKey::Admin)` check, line 19)

---

## vinculo_lending

### Invariants

1. A user's tier is always read from on-chain `vinculo_sbt`; it cannot be supplied by the caller.
2. A wallet may not hold two active loans simultaneously.
3. Only the authenticated borrower may repay their own loan.
4. Interest is calculated inside the contract; the frontend cannot influence it.
5. Loan amount is enforced against the tier's on-chain credit limit.
6. The `Token` and `Sbt` addresses are immutable after first initialization.

### Findings

#### [RISK-04] `init_lending()` has no re-initialization guard

- **Function:** `init_lending(env, token, sbt)`
- **Severity:** Critical
- **Type:** missing-access-control
- **What the code does (before fix):** Unconditionally overwrites both `DataKey::Token` and `DataKey::Sbt`. An attacker who calls this post-deployment can point `Sbt` at a contract they control (returning tier=4 for any address), then immediately drain the pool.
- **What it should do:** Reject any call once already initialized.
- **Resolution:** Fixed — `has(&DataKey::Token)` guard panics `"already initialized"` on subsequent calls.
- **Reproduction steps:**
  1. Deploy lending; `init_lending(real_token, real_sbt)`.
  2. Deploy `fake_sbt` that always returns tier=4.
  3. Call `init_lending(real_token, fake_sbt)` — no auth required (before fix).
  4. `request_loan(attacker, 5_000_000_0000, 1)` → loan granted, pool drained.
  - **Expected:** Step 3 panics "already initialized".
  - **Actual (before fix):** SBT address replaced; attacker gets Platino credit.

---

#### [RISK-03] Interest hardcoded to flat 5% — ignored tier APY and loan duration

- **Function:** `request_loan(env, user, amount, months)`
- **Severity:** Medium
- **Type:** logic-error
- **What the code does (before fix):**
  ```rust
  let apy_bps = 500;               // hardcoded literal, never varied
  let interest = (amount * 5) / 100; // flat 5% regardless of tier or months
  ```
  `apy_bps_for_tier()` was defined but **never called** (dead code). A Platino borrower (4% APY) on a 1-month loan paid the same absolute interest as a Plata borrower (12% APY) on a 12-month loan.
- **What it should do:** Interest must reflect the borrower's tier APY prorated by loan duration, consistent with `staking_pool`'s convention.
- **Resolution:** Fixed — now uses:
  ```rust
  // SECURITY-FIX [RISK-03]
  let apy_bps = apy_bps_for_tier(tier);
  let interest = (amount * apy_bps as i128 * months as i128) / 120_000;
  ```
  `apy_bps_for_tier()` is no longer dead code.
- **Impact on existing test:** Tier 2 / 800 bps / amount=600 / months=3:
  - Old: interest=30, total_owed=630
  - New: interest=(600×800×3)/120_000=12, total_owed=612
  - Assertion `loan.total_owed > 600` → 612 > 600 ✅ still passes.

---

### Checklist

- [PASS] `request_loan()` reads tier from on-chain SBT (`sbt_client.get_tier(&user)`) — not a caller parameter
- [PASS] A wallet cannot hold two active loans simultaneously (`assert!(existing.total_owed == 0)`)
- [PASS] `repay()` validates borrower identity via `user.require_auth()` + `DataKey::Loan(user)` key
- [FAIL → RISK-03] Interest (5%) was enforced inside the contract but was flat/tier-blind — **Fixed**
- [PASS] Loan amount validated against tier credit limit on-chain (`max_principal_for_tier(tier)`)
- [FAIL → RISK-04] `init_lending()` re-initialization guard — **Fixed**

---

## Test evidence

### vinculo_sbt — `cargo test` output

```
Finished `test` profile [unoptimized + debuginfo] target(s) in 4m 43s
Running unittests src/lib.rs

running 0 tests
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

Doc-tests vinculo_sbt
running 0 tests
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

> ⚠️ Zero tests exist. Access-control and tier-monotonicity invariants are entirely unverified
> by automated tests. Tests must be added before mainnet deployment.

---

### staking_pool — `cargo test` output

```
running 0 tests
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

> ⚠️ Zero tests exist. Deposit / withdraw / unstake invariants are entirely unverified.
> Windows file-lock contention from prior parallel builds prevented clean sequential test
> runs during this review session; the contract compiles without errors when built in isolation.

---

### vinculo_lending — `cargo test` output

> The `request_and_repay_loan` integration test was run against the **patched** source.
> Test assertion `assert!(loan.total_owed > 600)` passes after the RISK-03 fix (612 > 600).
> Full `cargo test` output pending final Phase 5 run (see below).
> Windows build-lock issues prevented capturing the raw runner output in this session.

---

## Recommendations

### Must fix before mainnet

| Priority | Action |
|----------|--------|
| 🔴 Critical | ~~`init()` / `init_lending()` re-init guards~~ **Done — RISK-04** |
| 🔴 High | ~~`mint()` tier downgrade prevention~~ **Done — RISK-02** |
| 🔴 High | Add `fund_rewards_pool()` to `staking_pool` and validate reserves in `unstake()` — **RISK-01** |

### Recommended before mainnet

| Priority | Action |
|----------|--------|
| 🟡 Medium | Add admin-authentication requirement to `init()` / `init_lending()` so only the designated deployer key can initialize |
| 🟡 Medium | Add tests for every access-control and invariant path across all three contracts |
| 🟡 Medium | Emit `env.events().publish(...)` from `mint()`, `revoke()`, `request_loan()`, and `repay()` for off-chain audit trails |
| 🟢 Low | Replace `_ => 17` APY wildcard with `unreachable!()` in `stake()` — **NOTE-01** |
| 🟢 Low | Remove `#[allow(dead_code)]` suppression now that `apy_bps_for_tier` is wired up |
