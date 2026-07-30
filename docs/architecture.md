# Architecture

## Overview

Vyn is a DeFi savings and credit app built on Stellar/Soroban. It has three layers:

```
Browser (React)
    │
    ├── Vercel API        — serverless functions (scoring, minting, credit)
    └── Stellar Testnet   — three Soroban smart contracts
```

Authentication is **wallet-based**: the connected Stellar address is stored in
`localStorage.vinculo_wallet` and gates the routes. There is no separate auth backend or
user database. Connection and signing go through Stellar Wallets Kit (see
[Wallet providers](#wallet-providers) below), which supports Freighter, xBull, Lobstr,
Hana and Rabet on desktop, and Albedo on mobile.

---

## Layer 1 — Frontend

**Stack:** Vite · React · TypeScript · Tailwind CSS  
**Entry:** `src/main.tsx` → `src/App.tsx`

### Routing (`src/App.tsx`)

| Path | Page | Guards |
|---|---|---|
| `/login` | `Login` | public |
| `/bienvenida` | `Onboarding` | `RequireWallet` |
| `/` | `Index` | `RequireWallet` + `RequireOnboarding` |
| `/historial` | `Historial` | `RequireWallet` + `RequireOnboarding` |
| `/perfil` | `Perfil` | `RequireWallet` + `RequireOnboarding` |
| `/retiros` | `Retiros` | `RequireWallet` + `RequireOnboarding` |
| `/notificaciones` | `Notificaciones` | `RequireWallet` + `RequireOnboarding` |
| `/ayuda` | `Ayuda` | `RequireWallet` + `RequireOnboarding` |

**Guards:**
- `RequireWallet` — redirects to `/login` if `localStorage.vinculo_wallet` is absent.
- `RequireOnboarding` — redirects to `/bienvenida` if `localStorage.vinculo_onboarded !== "1"`.

### State (`src/context/AppContext.tsx`)

In-memory React context. Tracks deposits, withdrawals, stakes, and credit state for the current session. Not persisted to a database — on-chain data is the source of truth.

| Action | Effect |
|---|---|
| `addDeposit(amount)` | Appends deposit, increments counter, triggers unlock celebration |
| `withdrawCredit()` | Sets `creditWithdrawn = true` |
| `addWithdrawal(amount, txHash)` | Appends withdrawal, decrements balance |
| `addStake(amount, months)` | Appends stake position with APY |

### Key components

| Component | Responsibility |
|---|---|
| `BalanceCard` | Displays on-chain staking balance via `fetchContractBalance` |
| `ProgressRing` | Visual progress toward next tier |
| `CreditSection` | Polls `/api/get-available-credit`, handles loan request and repayment |
| `DepositModal` | Freighter-signed deposit to `staking_pool` contract |
| `NFTModal` | Shows NFT tier image and metadata |

### Stellar helpers (`src/stellar/`)

| File | Purpose |
|---|---|
| `contracts.ts` | Exports `CONTRACT_ID` (staking_pool) and `RPC_URL` |
| `queries.ts` | `fetchContractBalance(address)` and `fetchStakeInfo(address)` — read-only Soroban simulations |

### Hooks

| Hook | Purpose |
|---|---|
| `useWallet` | Reads `vinculo_wallet` from localStorage, provides `shortWallet`, `walletMismatch` and `disconnect` |

### Wallet providers (`src/lib/stellarWalletsKit.ts`, `src/wallet/`)

Connect and sign both go through **Stellar Wallets Kit**, which owns its own
provider-selection modal (`kit.authModal()`). App code never branches on which wallet was
chosen — `connectWallet()` / `signTransactionXdr()` in `mobileWalletConnectors.ts` are
provider-agnostic, and `StellarWalletAdapter` (the `WalletAdapter` implementation used
throughout the app) simply delegates to them. Adding a new provider is a matter of
registering its module in `stellarWalletsKit.ts` — no other files need to change.

Registered modules: `FreighterModule`, `AlbedoModule`, `xBullModule`, `LobstrModule`,
`HanaModule`, `RabetModule`.

| Environment | Providers | Notes |
|---|---|---|
| Desktop | Freighter, xBull, Lobstr, Hana, Rabet | User picks one from the kit's modal; the choice is persisted (`vinculo_wallet_provider`) and restored on reload. |
| Mobile | Albedo | Selected automatically; also reachable via Privy for email login (see `privyBridge.ts`). |

**xBull on desktop:** connect and sign follow the same path as every other desktop
provider above — no xBull-specific code exists or is needed. `useWallet`'s Freighter
"extension gone" polling (`src/hooks/useWallet.tsx`) only applies when `provider ===
FREIGHTER_ID`; other providers, including xBull, are not polled for availability and rely
on the kit surfacing connection/signing errors directly.

---

## Layer 2 — Serverless API

Deployed as Vercel serverless functions. Routes are defined in `vercel.json`.

| Endpoint | Method | Purpose |
|---|---|---|
| `POST /api/calculate-score` | POST | Computes reputation score from Horizon transaction history |
| `POST /api/get-available-credit` | POST | Reads NFT tier from `vinculo_sbt` contract, returns credit limit |
| `POST /api/evaluate-and-mint` | POST | Calls `calculate-score`, then mints NFT via `vinculo_sbt.mint()` |
| `GET /api/get-user-data` | GET | Reads staking balance from `staking_pool`, derives a legacy tier |
| `GET /api/health` | GET | Returns a lightweight service health signal for deploy checks |
| `GET /api/readiness` | GET | Returns a readiness signal for smoke tests and deployment validation |

## Health and readiness checks

- `GET /api/health` returns `200` and a JSON payload with `status: "ok"`, `endpoint: "/api/health"`, and `timestamp`.
- `GET /api/readiness` returns `200` and a JSON payload with `status: "ready"`, `endpoint: "/api/readiness"`, and `timestamp`.
- Non-`GET` requests receive `405 Method Not Allowed` and an `Allow: [GET]` response header.
- A missing or unreachable endpoint indicates a deployment or server failure; a `5xx` response indicates a function runtime error.

All functions set permissive CORS headers and handle `OPTIONS` preflight.

---

## Layer 3 — Soroban Contracts

Source in `backend/contracts/`. All deployed to Stellar Testnet.

| Contract | Env var | Responsibility |
|---|---|---|
| `staking_pool` | `CONTRACT_ID` (hardcoded) | Accepts XLM deposits, tracks balances and stake positions |
| `vinculo_sbt` | `NFT_CONTRACT_ID` | Mints and stores SBT/NFT tiers per wallet address |
| `vinculo_lending` | `VITE_LENDING_CONTRACT_ID` | Issues and tracks loans (`request_loan`, `repay`) |

**Key functions called by the app:**

| Contract | Function | Called from |
|---|---|---|
| `staking_pool` | `deposit` | `DepositModal` (Freighter-signed) |
| `staking_pool` | `get_balance` | `queries.ts`, `api/get-user-data.js` |
| `staking_pool` | `get_stake` | `queries.ts` |
| `vinculo_sbt` | `mint` | `api/evaluate-and-mint.js` (admin-signed) |
| `vinculo_sbt` | `get_tier` | `api/get-available-credit.js` (simulated) |
| `vinculo_lending` | `request_loan` | `CreditSection` (Freighter-signed) |
| `vinculo_lending` | `repay` | `CreditSection` (Freighter-signed) |

---

## Tier System

| Tier | Name | Score threshold | Credit limit |
|---|---|---|---|
| 0 | Bronce | < 50 | 0 XLM (locked) |
| 1 | Plata | ≥ 50 | 300 XLM |
| 2 | Oro | ≥ 150 | 600 XLM |
| 3 | Diamante | ≥ 500 | 1 500 XLM |
| 4 | Platino | ≥ 1 000 | 5 000 XLM |

The tier is stored on-chain in `vinculo_sbt`. The scoring engine in `api/calculate-score.js` computes a score from Horizon transaction history and maps it to a tier number. `api/evaluate-and-mint.js` is the only path that writes a new tier to the contract.

---

## Where to make common changes

| Change | Files to touch |
|---|---|
| Add a new page | `src/pages/`, `src/App.tsx` (add route) |
| Change credit limits | `api/get-available-credit.js` → `CREDIT_LIMITS` |
| Change score thresholds | `api/calculate-score.js` → tier mapping block |
| Change staking APY | `src/context/AppContext.tsx` → `STAKING_APY` |
| Add a contract function call | `src/stellar/queries.ts` (read) or component (write, Freighter-signed) |
| Add an API endpoint | `api/<name>.js` + entry in `vercel.json` routes |
