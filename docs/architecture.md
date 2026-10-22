---
tags: [architecture]
updated: 2026-10-22
files:
  - src/App.tsx
  - src/context/WalletSessionContext.tsx
  - src/context/AppContext.tsx
  - src/lib/chainData.ts
  - src/stellar/
  - api/
  - backend/contracts/
  - vercel.json
---

# Architecture

## Overview

Vyn is a savings and credit app on Stellar/Soroban **testnet**. Users save USDC in a pool
that earns real yield from a DeFindex vault, build a reputation score from that behavior,
receive a soulbound tier token (SBT) and borrow against the tier. They can also move money in
and out with Mexican bank transfers (SPEI) through BlindPay.

```
Browser (React SPA)
  ├─ wallet: Stellar Wallets Kit (Freighter, Albedo, xBull, LOBSTR, Hana, Rabet, WalletConnect)
  │          or Privy (email / Google / passkey → embedded Stellar wallet)
  ├─ Soroban RPC + Horizon (testnet)  ── staking_pool ─▶ DeFindex vault
  │                                    ── vinculo_lending ─▶ vinculo_sbt.get_tier
  └─ /api/* on Vercel (10 Node functions)
        ├─ scoring, SBT mint, credit       → Soroban RPC (admin key)
        ├─ SPEI on/off-ramp                → BlindPay API, Horizon (admin / payout keys)
        ├─ USDC faucet                     → Horizon (admin key)
        └─ idempotency and mapping         → Supabase (REST)
```

There is no user database and no backend session. The "session" is the connected address in
browser storage. API endpoints receive the address in the request and do not verify who sent
it (see [pending integrations](integrations/pending.md)).

Every external service has its own note: start at the
[integrations overview](integrations/overview.md).

---

## Layer 1 — Frontend

**Stack:** Vite 5 · React 18 · TypeScript · React Router 6 · React Query 5 · Tailwind ·
shadcn/ui · i18next (Spanish primary, English).
**Entry:** `src/main.tsx` → `src/App.tsx`. Every page is lazy-loaded with `React.lazy`.

### Routes (`src/App.tsx`)

| Path | Page | Guards |
|---|---|---|
| `/login` | `Login` | public |
| `/bienvenida` | `Onboarding` (redirects to `/` once onboarded) | `RequireWallet` |
| `/` | `Index` (home dashboard) | `RequireWallet` + `RequireOnboarding` |
| `/historial` | `Historial` | same |
| `/perfil` | `Perfil` (score, SBT mint, USDC activation, access methods) | same |
| `/retiros` | `Retiros` (USDC or SPEI withdrawal) | same |
| `/depositar` | `Depositar` (SPEI on-ramp) | same |
| `/tesoreria` | `Tesoreria` (treasury panel; nav entry only for `VITE_TREASURY_ADDRESS`) | same |
| `/notificaciones` | `Notificaciones` | same |
| `/ayuda` | `Ayuda` | same |
| `*` | `NotFound` | — |

**Guards** read `WalletSessionContext`, which loads the session once at startup:

- `RequireWallet` shows a spinner until the session is loaded, then redirects to `/login` if
  there is no address.
- `RequireOnboarding` redirects to `/bienvenida` if `vinculo_onboarded !== "1"`.

### Session (`src/context/WalletSessionContext.tsx`, `src/lib/sessionStore.ts`)

Keys `vinculo_wallet`, `vinculo_wallet_provider` (a kit wallet ID or `"privy"`) and
`vinculo_onboarded`, stored in `localStorage` and mirrored to 30-day cookies so the session
survives unreliable mobile storage. On desktop with Freighter it checks the extension every
1.5 s and exposes `walletMismatch` when the active account changes. `disconnect()` clears
the keys and logs out of Privy.

### In-memory UI state (`src/context/AppContext.tsx`)

Session-only flags: deposit counter and unlock celebration, `creditWithdrawn` (an open loan),
local withdrawals list, success modals and `scoreAnomaly`. Nothing here is persisted; on-chain
data is the source of truth, and an open loan is forgotten on reload
([pending](integrations/pending.md#in-memory-state-that-should-come-from-the-chain)).

### Key components

| Component | Responsibility |
|---|---|
| `AppShell`, `BottomNav`, `navItems.ts` | Layout, header ("Actualizando…" while chain data loads), sidebar and bottom nav. |
| `BalanceCard` | Savings position (`useSavings`). |
| `ProgressRing`, `NftLevelCard` | Score and tier progress (`useScore`, `useCredit`). |
| `YieldCard` | Yield earned (`useYield`). |
| `CreditSection` | Credit limit (`useCredit`), loan request and repayment, 60 s demo countdown. |
| `ActivityList`, `PeriodSummaryCard` | Recent activity (`useActivity`). |
| `DepositModal` | Choose wallet deposit or SPEI; wallet deposit calls `staking_pool.deposit`. |
| `NFTModal` | Tier image (local `public/images/`) and the mint transaction link. |
| `WalletSetupModal` | Supported wallets and install links on `/login`. |
| `PrivyGate`, `PrivyLayer`, `PrivyBridge` | Lazy Privy layer ([Privy](integrations/privy.md)). |

### Stellar helpers (`src/stellar/`)

| File | Purpose |
|---|---|
| `contracts.ts` | `CONTRACT_ID` (`VITE_STAKING_CONTRACT_ID`), `LENDING_CONTRACT_ID`, `TREASURY_ADDRESS`, `RPC_URL`, reference `VAULT_ID`. |
| `queries.ts` | `readSavingsSnapshot` (position, deposited, withdrawn in one go); legacy `fetch*` helpers. |
| `deposit.ts` | `depositToVault(address, amount, sign)`, shared by the SPEI on-ramp. |
| `trustline.ts` | Friendbot funding, USDC trustline check/build/submit, USDC balance (Horizon). |
| `activity.ts` | History from Horizon operations plus locally stored mints. |
| `treasury.ts` | Accrued interest and pool balance of `vinculo_lending`. |

### Wallet providers (`src/lib/stellarWalletsKit.ts`, `src/lib/mobileWalletConnectors.ts`, `src/wallet/`)

Connect and sign go through **Stellar Wallets Kit**, which owns the wallet-selection modal
(`kit.authModal()`). Registered modules: Freighter, Albedo, xBull, LOBSTR, Hana, Rabet, and
WalletConnect when `VITE_WALLETCONNECT_PROJECT_ID` is set. App code never branches on the
wallet: `connectWallet()` / `signTransactionXdr()` are provider-agnostic, and
`StellarWalletAdapter` delegates to them. A Privy session signs through `privySign` instead.
Details: [Stellar Wallets Kit](integrations/stellar-wallets-kit.md).

### On-chain data and caching (`src/lib/chainData.ts`, `src/lib/queryClient.ts`)

Balances, credit/tier, score, activity and treasury figures are read through React Query
hooks (`useSavings`, `useYield`, `useCredit`, `useScore`, `useActivity`, `useTreasury`).
Each value is requested once per wallet and shared by every card that shows it. There is
**no polling**: data is fresh for 60 s and is read again when the user returns to the tab
or opens a page after that, or right after an action that changes it.

After a deposit, withdrawal, loan, repayment, SBT mint or treasury action, call
`useRefreshChainData()(address)`. It refreshes that wallet's data immediately, then the
Horizon-backed data (history and score) once more 6 s later, because Horizon indexes
confirmed transactions with a short delay. Wait for the transaction to be confirmed
first (`waitForConfirmation`); otherwise the network still returns the old values.
See [ADR-003](decisions/ADR-003-no-polling-cache.md). `Perfil` still has its own fetches.

### Email login (Privy)

Privy and its dependencies weigh about 2 MB, so they load only when needed. `PrivyGate`
mounts `PrivyLayer` next to the routes in three cases: on `/login`, for a Privy session, or
when something calls into the bridge. App code must not import `@privy-io/*`; it uses
`src/lib/privyBridge.ts`. See [ADR-001](decisions/ADR-001-lazy-privy.md),
[ADR-002](decisions/ADR-002-oldest-privy-wallet.md) and [Privy](integrations/privy.md).

---

## Layer 2 — Serverless API (`api/`)

Vercel Node functions built from `api/**/*.js` (`vercel.json` uses the legacy `builds`
format). Files starting with `_` and `.mjs` files are shared helpers, not functions. The
Hobby plan allows 12 functions per deployment; there are 10
([Vercel](integrations/vercel.md)).

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/calculate-score` | POST | Score and tier from the `staking_pool` counters (`_scoring-core.mjs`). |
| `/api/evaluate-and-mint` | POST | Recomputes the score and mints the SBT tier with the admin key. |
| `/api/get-available-credit` | POST | Reads the SBT tier and returns the credit limit. |
| `/api/faucet-usdc` | POST | Sends 2 test USDC once per wallet. |
| `/api/onramp?action=…` | GET/POST | SPEI on-ramp: init, quote, payin, status, settle. |
| `/api/blindpay?action=…` | GET/POST | SPEI off-ramp: quote, payout, status. |
| `/api/health` | GET | Liveness. |
| `/api/readiness` | GET | Checks Supabase; used by the keep-alive workflow. |
| `/api/nonce` | POST | Unused (legacy). |
| `/api/get-user-data` | GET | Unused (legacy). |

Request and response shapes: [API reference](api.md). Shared modules: `_scoring-core.mjs`,
`_blindpay-core.mjs`, `_blindpay-onramp.mjs`, `_faucet-core.mjs`, `_usdc.mjs`,
`_supabase.mjs`, `_logger.mjs` (JSON logs) and `validation.mjs` (zod schemas).

`backend/server.js` is an Express server for local development that mirrors most endpoints
on port 3000 (Vite proxies `/api` to it). It is not deployed and has drifted: it lacks the
consolidated `/api/blindpay` route.

---

## Layer 3 — Soroban contracts (`backend/contracts/`)

All on testnet. None has an `upgrade` function, so a change means a redeploy with a new ID
([migration](contracts/migration.md)).

| Contract | ID variable(s) | Token | Responsibility |
|---|---|---|---|
| `staking_pool` | `VITE_STAKING_CONTRACT_ID`, `STAKING_CONTRACT_ID` | USDC | Custodies deposits in a DeFindex vault, tracks shares and the counters used for scoring ([DeFindex](integrations/defindex.md)). |
| `vinculo_sbt` | `NFT_CONTRACT_ID` | — | Stores one tier (0–4) per address; only the admin can `mint` or `revoke`. |
| `vinculo_lending` | `VITE_LENDING_CONTRACT_ID` | XLM (native) | Loans up to the tier's limit at 5 % flat; interest goes to the treasury. |

**Functions called by the app:**

| Contract | Function | Called from |
|---|---|---|
| `staking_pool` | `deposit` | `DepositModal`, `depositToVault` (user-signed) |
| `staking_pool` | `withdraw` | `Retiros` (user-signed) |
| `staking_pool` | `get_position`, `get_total_deposited`, `get_total_withdrawn` | `readSavingsSnapshot`, scoring |
| `staking_pool` | `get_tx_count` | scoring |
| `vinculo_sbt` | `mint` | `api/evaluate-and-mint.js` (admin-signed) |
| `vinculo_sbt` | `get_tier` | `api/get-available-credit.js` (simulated) |
| `vinculo_lending` | `request_loan`, `repay` | `CreditSection` (user-signed) |
| `vinculo_lending` | `fund_pool`, `withdraw_interest`, `withdraw_pool` | `Tesoreria` (treasury-signed) |
| `vinculo_lending` | `get_accrued_interest`, `get_pool_balance` | `treasury.ts` (simulated) |

---

## Tier system

| Tier | Name | Score | Credit limit (XLM) |
|---|---|---|---|
| 0 | Bronce | < 50 | 0 (locked) |
| 1 | Plata | ≥ 50 | 300 |
| 2 | Oro | ≥ 150 | 600 |
| 3 | Diamante | ≥ 500 | 1 500 |
| 4 | Platino | ≥ 1 000 | 5 000 |

The score comes from the user's on-chain counters in `staking_pool`
(`api/_scoring-core.mjs`): at least 3 transactions are required, then
`score = min(position / deposited, 1) × log10(txCount + 1) × 100`, multiplied by 0.2 if the
position is below 10 % of what was deposited, and capped at 1 000. Tiers 3 and 4 are
practically unreachable with this curve (issue #95). The tier is stored on-chain by
`api/evaluate-and-mint.js`; the credit limits live in both `api/get-available-credit.js`
(`CREDIT_LIMITS`) and `vinculo_lending` (`max_principal_for_tier`).

---

## Where to make common changes

| Change | Files to touch |
|---|---|
| Add a page | `src/pages/`, a lazy route in `src/App.tsx`, `src/components/navItems.ts` if it needs a tab |
| Show on-chain data | A hook in `src/lib/chainData.ts` (no polling, [ADR-003](decisions/ADR-003-no-polling-cache.md)) |
| Add user-facing text | `src/i18n/locales/es.ts` and `en.ts` |
| Change credit limits | `api/get-available-credit.js` `CREDIT_LIMITS` **and** `max_principal_for_tier` in `vinculo_lending` (redeploy) |
| Change score thresholds or formula | `api/_scoring-core.mjs`, plus `tierFromScore` in `Perfil.tsx` and the thresholds in `ProgressRing` |
| Add an API endpoint | Prefer a new `action` in an existing function; a new `api/<name>.js` uses one of the 2 remaining Vercel functions. Shared code goes in `api/_<name>.mjs`. |
| Add a contract call | Read: `src/stellar/` + a `chainData` hook. Write: build, `prepareTransaction`, sign with the wallet layer, wait for confirmation, refresh. |
