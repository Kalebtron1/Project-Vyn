---
tags: [adr, contracts, reputation]
status: accepted
date: 2026-11-03
files:
  - backend/contracts/vinculo_sbt/src/lib.rs
  - backend/contracts/staking_pool/src/lib.rs
  - backend/contracts/vinculo_lending/src/lib.rs
---

# ADR-006: The contract calculates the reputation tier

## Context

The backend calculated the score and minted the tier with a key that could set any level.
The score counted transactions of any size, so activity mattered more than saved capital.

## Decision

- `vinculo_sbt` has no `mint`. The tier comes from savings stats in `staking_pool` and the
  payment history in `vinculo_lending`, so no key can assign a level.
- Anyone can call `refresh_tier`. The result does not depend on the caller.
- A tier needs a current balance, a time-weighted balance and time since the first deposit:

| Tier | Balance | Time | Payment history |
|---|---|---|---|
| Bronce | None | None | None |
| Plata | 10 USDC | 30 days | 3 deposits of at least 10 USDC |
| Oro | 50 USDC | 90 days | 1 loan repaid on time |
| Diamante | 200 USDC | 180 days | 3 repaid on time, no defaults |
| Platino | 1,000 USDC | 365 days | 6 repaid on time, no defaults |

- A tier can go down. Withdrawing below the balance lowers it.
- A default means Bronce for 90 days, and until any uncovered debt is paid with
  `repay_bad_debt`.
- `vinculo_lending` asks for the live tier with `compute_tier`, passing its own history.
  Soroban does not allow a contract to be re-entered while it is on the call stack, so the
  SBT cannot call back. Loans therefore never use a stale stored tier.
- The admin can change these rules with `set_config`.

## Consequences

- `api/evaluate-and-mint.js` and `api/calculate-score.js` stop being needed once the
  frontend moves to these contracts.
- Tiers restart with the redeploy, because the old contracts have no time-weighted data.
- Rules with long periods make demos slow, so deploy values can scale the time.
- Signals from outside the chain, such as identity checks, are not part of the tier yet.
- Diamante and Platino stay closed after any default unless the admin changes the rules.
