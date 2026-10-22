---
tags: [integration, stellar, horizon]
updated: 2026-10-22
files:
  - src/stellar/trustline.ts
  - src/stellar/activity.ts
  - src/components/PrivyBridge.tsx
  - src/pages/Perfil.tsx
  - src/pages/Depositar.tsx
  - api/_usdc.mjs
  - api/_faucet-core.mjs
---

# Horizon and Friendbot

**Horizon** is Stellar's REST API for accounts, balances, operations and classic
(non-Soroban) transactions. **Friendbot** is the testnet service that creates and funds a new
account with test XLM. Both are testnet-only here.

## Configuration

No environment variables. Hard-coded URLs:

| URL | Files |
|---|---|
| `https://horizon-testnet.stellar.org` | `src/stellar/trustline.ts`, `src/stellar/activity.ts`, `src/components/PrivyBridge.tsx`, `api/_usdc.mjs` |
| `https://friendbot.stellar.org` | `src/stellar/trustline.ts`, `src/components/PrivyBridge.tsx` |

The project's USDC asset (code `USDC`, issuer starting with `GATALTGT`) is also hard-coded
twice: `USDC_ASSET` in `src/stellar/trustline.ts` and `USDC` in `api/_usdc.mjs`. Both must
match the token the `staking_pool` was initialized with.

## Calls

| Request | Function | Used for |
|---|---|---|
| `GET /accounts/{id}` | `ensureTestnetAccount`, `hasUsdcTrustline`, `getUsdcBalance` (`trustline.ts`); `ensureFundedTestnet` (`PrivyBridge.tsx`) | Does the account exist? Does it trust USDC? USDC balance before a deposit. |
| `GET /accounts/{id}` (SDK `loadAccount`) | `buildUsdcTrustlineXdr`; `usdcBalance` and `sendUsdcFromAdmin` (`api/_usdc.mjs`) | Sequence number to build a classic transaction; faucet trustline check. |
| `GET /accounts/{id}/operations?limit=100&order=desc&include_failed=false` | `fetchActivity` (`src/stellar/activity.ts`, via `useActivity`) | Home and Historial activity. |
| `POST /transactions` (SDK `submitTransaction`) | `submitClassicXdr` (`trustline.ts`); `sendUsdcFromAdmin` (`api/_usdc.mjs`) | USDC trustline signed by the user; USDC payments from the admin account (faucet, on-ramp settlement). |
| `GET friendbot?addr={id}` | `ensureTestnetAccount`, `ensureFundedTestnet` | Creates a new wallet on testnet so it can pay fees and hold trustlines. |

### How activity is built

`fetchActivity` reads the last 100 operations of the user and keeps only
`invoke_host_function` operations whose `asset_balance_changes` move funds between the user
and one of the current contracts:

- to/from `staking_pool` → `deposit` / `savings_withdraw` (USDC),
- from/to `vinculo_lending` → `loan` / `repay` (XLM).

SBT mints are signed by the admin, so they never appear in the user's operations. Perfil
stores them in `localStorage` (`vinculo_activity_mints`, last 50) after a successful mint,
so a mint only shows in the history of the device that claimed it.

### Where Friendbot runs

- Right after a Privy wallet is ready (`ensureFundedTestnet`, in the background).
- When Perfil opens, and again before building a USDC trustline (`ensureTestnetAccount`), so
  external wallets that never received XLM can add the trustline. It waits up to ~9 s for
  Horizon to see the new account.

## Failure modes

| Failure | Behavior |
|---|---|
| Account does not exist (`404`) | Treated as empty: no activity, no trustline, balance 0. Friendbot is called where needed. |
| Horizon indexing lag | A confirmed transaction appears a few seconds later. History and score refresh once more 6 s after an action (`HORIZON_LAG_MS`). Perfil and the faucet retry trustline reads a few times. |
| Horizon error on `/operations` | `fetchActivity` logs it and returns only the local mints. |
| Classic transaction rejected | `submitClassicXdr` and `sendUsdcFromAdmin` throw `Horizon: {result_codes}` (e.g. `op_no_trust`, `op_underfunded`). |
| Friendbot down or rate-limited | Errors are ignored; the next step (trustline) fails with "account not funded", which Perfil shows as a toast. |
| More than 100 operations | Older activity is not shown (no pagination). |

## Mainnet notes

Friendbot does not exist on mainnet. The comments in the code say the treasury would fund
new accounts there; nothing implements that yet.

## Related

- [Soroban RPC](soroban-rpc.md) · [USDC faucet](usdc-faucet.md) · [Privy](privy.md)
