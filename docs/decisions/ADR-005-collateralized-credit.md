---
tags: [adr, contracts, credit]
status: accepted
date: 2026-11-03
files:
  - backend/contracts/vinculo_lending/src/lib.rs
  - backend/contracts/staking_pool/src/lib.rs
---

# ADR-005: Credit backed by the user's savings, in USDC

## Context

The deployed credit contract lends XLM against the SBT tier alone. Nothing backs a loan and
nothing happens when it is due. A reputation score on a public chain cannot tell whether two
wallets belong to one person, so it is not enough to protect the lending pool.

## Decision

- Savings and loans use the same asset, USDC. There is no price risk and no oracle.
- `vinculo_lending` asks `staking_pool` to lock savings as collateral. The savings stay in
  the vault and keep earning yield, but they cannot be withdrawn until the loan is repaid.
- The lock is stored in pool shares, so collateral follows the real value of the vault.
- The tier sets the loan-to-value ratio and the maximum principal:

| Tier | LTV | Maximum principal |
|---|---|---|
| Bronce | No credit | 0 |
| Plata | 50% | 100 USDC |
| Oro | 60% | 250 USDC |
| Diamante | 70% | 750 USDC |
| Platino | 80% | 2,000 USDC |

- Interest is 12% a year, simple, and fixed when the loan starts. Payments cover interest
  first, then principal.
- There are 7 days of grace after the due date, with no extra cost. After that anyone can
  call `liquidate`, which takes the debt from the collateral and frees the rest.
- A default adds to the payment history that reputation reads. There is no money penalty.
- The admin can change these values with `set_config`. Active loans keep their own terms.
  The contract rejects values where the debt at the longest term exceeds 95% of the
  collateral.

## Consequences

- A wallet with no savings cannot borrow, so many wallets cost the pool nothing.
- A loan does not create new spending power beyond the user's savings. Credit without
  collateral would need identity checks and is a separate decision.
- If the vault loses more than the margin, a default can leave debt uncovered. The contract
  records it in `get_bad_debt` and the lending pool absorbs it.
- A user who needs money sooner can only use the free part of the savings.
- The frontend must call the new function signatures, so it changes together with the
  redeploy.
