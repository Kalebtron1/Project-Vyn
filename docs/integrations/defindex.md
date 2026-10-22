---
tags: [integration, defindex, contracts, yield]
updated: 2026-10-22
prs: [77]
files:
  - backend/contracts/staking_pool/src/lib.rs
  - backend/contracts/staking_pool/src/test.rs
  - src/stellar/contracts.ts
  - src/stellar/queries.ts
  - src/lib/chainData.ts
  - scripts/create_vault.sh
  - scripts/deploy_contracts.sh
  - scripts/harvest_keeper.sh
  - scripts/smoke_test_staking.sh
---

# DeFindex

[DeFindex](https://github.com/paltalabs/defindex) (by PaltaLabs) is a Stellar yield protocol.
Users' USDC savings in Vyn sit in a DeFindex **vault**, and the yield users see is the real
appreciation of that vault's shares. It replaced a synthetic APY in PR #77 (June 2026).

## Architecture

```
User wallet ──deposit(USDC)──▶ staking_pool ──vault.deposit(from = staking_pool)──▶ DeFindex vault ──▶ fixed_apr strategy
            ◀─withdraw(USDC)── staking_pool ◀──vault.withdraw(shares)────────────── DeFindex vault
```

- `staking_pool` is the **custodian**: it deposits into the vault as itself and keeps an
  internal ledger `Shares(user)` with each user's share of the vault tokens (dfTokens).
- The vault is Vyn's own, created through the DeFindex factory with the **`fixed_apr`**
  strategy (`scripts/create_vault.sh`): one asset (USDC), one strategy, fee 0, all roles held
  by the admin key, upgradable. The fixed APR makes yield visible on testnet.
- The vault address is stored in `staking_pool` at `init(admin, token, vault)` and can be
  changed with `set_vault` (admin only). `src/stellar/contracts.ts` keeps a `VAULT_ID`
  constant for reference only; the app never reads it.

## Contract interface used

`staking_pool` declares a minimal client of the vault (`VaultClient`), mirroring
`apps/contracts/vault/src/interface.rs` in the DeFindex repo:

| Vault function | Used in | Notes |
|---|---|---|
| `deposit(amounts_desired, amounts_min, from, invest)` | `staking_pool.deposit` | `amounts_min = amount`, `invest = true`. The return value is ignored; minted shares are measured as the change in `balance(staking_pool)`. |
| `balance(id)` | `deposit` | dfToken (SEP-41) balance before and after. |
| `withdraw(df_amount, min_amounts_out, from)` | `staking_pool.withdraw` | `min_amounts_out = [0]` (no slippage protection, issue #104). |
| `get_asset_amounts_per_shares(shares)` | `get_position`, `withdraw` | Live value of the user's shares in USDC. |

Before calling `vault.deposit`, `staking_pool` authorizes the nested
`token.transfer(staking_pool → vault)` with `authorize_as_current_contract`. No other
contract call may happen between that authorization and the deposit, or the transfer fails
with `Error(Auth, InvalidAction)` (see the comment in `deposit`).

### `staking_pool` functions read by the app

| Function | Meaning | Read by |
|---|---|---|
| `get_position(user)` | Redeemable USDC now (principal + yield) | `useSavings`, scoring, mint fallback |
| `get_total_deposited(user)` / `get_total_withdrawn(user)` | Cumulative USDC in / out | `useSavings`, scoring |
| `get_tx_count(user)` | Deposits + withdrawals | Scoring (minimum 3 for any tier) |
| `get_shares`, `get_vault` | Raw shares, vault address | Tests and scripts only |

Yield shown in the app = `position − (deposited − withdrawn)` (`useYield` in
`src/lib/chainData.ts`).

## Keeping yield visible: the keeper

`scripts/harvest_keeper.sh` loops every 30 s (configurable) and:

1. reads the vault's idle funds (`fetch_total_managed_funds`) and, if any, invests them in
   the strategy with `rebalance` (signed by the admin), because, as the script notes,
   `deposit(invest = true)` does not move new funds into the strategy by itself;
2. calls `strategy.harvest(from = vault)` so accrued yield is reflected in the share price.

It runs only on someone's machine with the admin secret. Nothing in Vercel or GitHub Actions
runs it, so **position and yield stop growing whenever the keeper is off**. The strategy also
needs its own USDC reserve to pay the yield on withdrawal.

## Environment variables

At runtime only the contract IDs (`VITE_STAKING_CONTRACT_ID`, `STAKING_CONTRACT_ID`; see
[Soroban RPC](soroban-rpc.md)). The scripts read `ADMIN_SECRET`, `ADMIN_PUBLIC`, `USDC_SAC`,
`DEFINDEX_DIR`, `APR_BPS`, `FACTORY`, `SOROSWAP_ROUTER`, `VAULT`, `STRATEGY`, `INTERVAL`,
`TOKEN_ADDRESS`, `VAULT_ADDRESS` and `NETWORK` from the shell; they have testnet defaults
for the factory, router, vault and strategy.

## Failure modes

| Situation | Effect |
|---|---|
| Keeper not running | No new yield; idle deposits stay uninvested. |
| Vault or strategy short of USDC | `withdraw` returns less or fails inside the vault. |
| `set_vault` while users have shares | Their `Shares` point at the old vault and `get_position` reads the wrong vault. The contract comment warns to migrate funds first. |
| Vault not set | `get_position` returns 0; `deposit` and `withdraw` fail with `NotInitialized`. |
| Rounding | `withdraw` burns `floor(shares × amount / position)` and returns what the vault actually paid, which can differ slightly from `amount`. |
| Testnet reset | Vault, strategy and pool disappear. Run `create_vault.sh`, then `deploy_contracts.sh`, and update the IDs in Vercel. |

## Tests

`backend/contracts/staking_pool/src/test.rs` uses a `MockVault` with a configurable share
rate. CI runs `cargo fmt --check`, `cargo clippy -D warnings` and `cargo test` for this
contract (`.github/workflows/ci.yml`). `scripts/smoke_test_staking.sh` does a real
deposit → position → withdraw round trip on testnet.

## Related

- [Soroban RPC](soroban-rpc.md) · [Contract migration](../contracts/migration.md) ·
  [Pending integrations](pending.md)
