---
tags: [integration, stellar, soroban]
updated: 2026-10-22
files:
  - src/stellar/contracts.ts
  - src/stellar/queries.ts
  - src/stellar/deposit.ts
  - src/stellar/treasury.ts
  - src/lib/chainData.ts
  - src/components/DepositModal.tsx
  - src/components/CreditSection.tsx
  - src/pages/Retiros.tsx
  - src/pages/Tesoreria.tsx
  - api/_scoring-core.mjs
  - api/evaluate-and-mint.js
  - api/get-available-credit.js
  - api/get-user-data.js
---

# Soroban RPC

The JSON-RPC endpoint used to read and write the three Soroban contracts
(`staking_pool`, `vinculo_sbt`, `vinculo_lending`). Everything runs on **Stellar testnet**.

## Configuration

There is no environment variable for the network. The RPC URL
`https://soroban-testnet.stellar.org` and `Networks.TESTNET` are hard-coded in:

- `src/stellar/contracts.ts` (`RPC_URL`, used by most frontend code),
- `src/components/CreditSection.tsx` (two literal URLs),
- `src/lib/stellarWalletsKit.ts` (`NETWORK_PASSPHRASE`),
- `api/_scoring-core.mjs`, `api/evaluate-and-mint.js`, `api/get-available-credit.js`,
  `api/get-user-data.js`, `api/_blindpay-core.mjs` and `backend/server.js`.

Moving to mainnet means changing every one of them (issue #97 proposes one shared config).

Contract IDs do come from the environment:

| Variable | Read by | Contract |
|---|---|---|
| `VITE_STAKING_CONTRACT_ID` | `src/stellar/contracts.ts` | `staking_pool` |
| `STAKING_CONTRACT_ID` | `api/_scoring-core.mjs` callers, `api/get-user-data.js`, `api/evaluate-and-mint.js`, `backend/server.js` | `staking_pool` (same ID) |
| `VITE_LENDING_CONTRACT_ID` | `src/stellar/contracts.ts`, `src/components/CreditSection.tsx` | `vinculo_lending` |
| `NFT_CONTRACT_ID` | `api/evaluate-and-mint.js`, `api/get-available-credit.js`, `backend/server.js` | `vinculo_sbt` |
| `SECRET_KEY_ADMIN` | `api/evaluate-and-mint.js`, `api/get-available-credit.js` | Signs `mint`; its account is also the source for the `get_tier` simulation. |

`VITE_*` values are baked in at build time: change them in Vercel and redeploy.

## Calls

**Reads** are `simulateTransaction` calls on a transaction that is never sent. A simulation
needs an existing source account, so each caller loads one first with `getAccount`.

| Contract function | Caller | Source account |
|---|---|---|
| `staking_pool.get_position`, `get_total_deposited`, `get_total_withdrawn` | `readSavingsSnapshot` (`src/stellar/queries.ts`, via `useSavings`) | The user |
| same + `get_tx_count` | `getOnChainAggregates` (`api/_scoring-core.mjs`) for `/api/calculate-score` | The user |
| `get_position`, `get_total_deposited`, `get_tx_count` | `/api/get-user-data` (no caller today) | The user |
| `get_position` | `/api/evaluate-and-mint` fallback when no volume is sent | The user |
| `vinculo_sbt.get_tier` | `/api/get-available-credit` | Admin account |
| `vinculo_lending.get_accrued_interest`, `get_pool_balance` | `src/stellar/treasury.ts` (via `useTreasury`) | Treasury wallet |

Amounts come back as `i128` with 7 decimals and are divided by `10_000_000`.

**Writes** follow `prepareTransaction` → sign → `sendTransaction` → poll `getTransaction`.

| Contract function | Caller | Signed by |
|---|---|---|
| `staking_pool.deposit(user, amount)` | `DepositModal`, `depositToVault` (`src/stellar/deposit.ts`) | User wallet |
| `staking_pool.withdraw(user, amount)` | `submitContractCall` in `src/pages/Retiros.tsx` | User wallet |
| `vinculo_lending.request_loan(user, amount, months=1)`, `repay(user, amount)` | `src/components/CreditSection.tsx` | User wallet (via `walletAdapter`) |
| `vinculo_lending.fund_pool`, `withdraw_interest`, `withdraw_pool` | `src/pages/Tesoreria.tsx` | Treasury wallet |
| `vinculo_sbt.mint(admin, user, tier)` | `mintNftOnChain` in `api/evaluate-and-mint.js` | Admin key on the server |

User signatures go through [Stellar Wallets Kit](stellar-wallets-kit.md) or
[Privy](privy.md). After a confirmed write, the caller refreshes the cache with
`useRefreshChainData()(address)` ([ADR-003](../decisions/ADR-003-no-polling-cache.md)).

## Failure modes

| Failure | Behavior |
|---|---|
| User account not funded | `getAccount` throws. `readSavingsSnapshot`, scoring and `get-user-data` treat it as an empty position (all 0). Writes fail. |
| Simulation error (no position, contract panic) | Read helpers return `0` for that value. |
| RPC unreachable at `getAccount` | Indistinguishable from an unfunded account: every read helper catches the error and returns zeros, and `/api/calculate-score` answers `200` with score 0. The cache then holds zeros until the next refresh. |
| RPC fails during a simulation | `readSavingsSnapshot` throws, so React Query retries once and keeps the last good data. The legacy `fetch*` helpers return `0`. `/api/calculate-score` returns `500`. `/api/get-available-credit` always returns `200` with tier 0, which hides the outage (issue #96). |
| `sendTransaction` status `ERROR` | Treated as rejected. The mint endpoint returns the decoded `errorResult`. |
| Transaction never confirms | `waitForConfirmation` and the mint endpoint stop after 30 s and 45 s. The loops in `Retiros.tsx` and `Tesoreria.tsx` poll every 2 s **without a deadline**. |
| Wrong or missing contract ID | Frontend logs `Falta VITE_STAKING_CONTRACT_ID` and reads return 0. API returns `500` with the missing variable's name. |

## Limits worth knowing

- Fees: `BASE_FEE` for most calls; `CreditSection` uses a fixed `100000` stroops.
  `prepareTransaction` adds the resource fee.
- Testnet is reset from time to time. A reset wipes the contracts and every balance, so all
  IDs in Vercel must be updated after redeploying ([migration guide](../contracts/migration.md)).
- Contract persistent entries are written without extending their TTL (issue #100), so idle
  entries can be archived and need restoring before they can be read or written again.

## Related

- [Horizon](horizon.md) for classic transactions and history.
- [DeFindex](defindex.md) for what `staking_pool` does with deposits.
