---
tags: [adr, contracts, security]
status: accepted
date: 2026-11-02
files:
  - backend/contracts/Cargo.toml
  - backend/contracts/staking_pool/src/lib.rs
  - backend/contracts/vinculo_lending/src/lib.rs
  - backend/contracts/vinculo_sbt/src/lib.rs
  - scripts/deploy_contracts.sh
---

# ADR-004: Upgradeable contracts with roles and pause

## Context

The deployed contracts have no `upgrade` function, so every change needs a new contract ID
and loses their storage. Their `init` functions run in a separate transaction from the
deploy, the SBT admin can never change, and nothing can stop them in an emergency.

## Decision

- All contracts live in one Cargo workspace on `soroban-sdk` 28, with OpenZeppelin Stellar
  Contracts 0.8.0 (`stellar-access`, `stellar-contract-utils`, `stellar-macros`).
- `__constructor` replaces `init`, so deploy and initialization are one transaction.
- The admin is a multisig account. It can upgrade, unpause and manage roles. The deployer
  keeps no power after deploying.
- The `pauser` role can only pause. Unpausing needs the admin, so a stolen pause key cannot
  resume a stopped contract.
- Pause blocks deposits, new loans, SBT mints and treasury withdrawals. It never blocks
  `withdraw` or `repay`: users can always take their money out and pay their debt.
- Writes extend the TTL of the entries they touch to 90 days.
- `vinculo_lending` calls the SBT through a local interface. Depending on the `vinculo_sbt`
  crate exported the SBT functions from the lending Wasm.

## Consequences

- This needs one last redeploy with new contract IDs. Later changes can be upgrades that
  keep the ID and the storage.
- The upgrade module does not check that a new Wasm keeps `upgrade` or a compatible storage
  layout. Tests must cover that for each upgrade.
- Wasm builds need `stellar contract build` (Stellar CLI 25.2 or newer), and the upgrade
  tests include the built Wasm, so build before running `cargo test`.
