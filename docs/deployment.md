---
tags: [deployment, vercel, operations]
updated: 2026-10-22
files:
  - vercel.json
  - .env.example
  - backend/server.js
  - vite.config.ts
  - .github/workflows/ci.yml
  - .github/workflows/supabase-keepalive.yml
---

# Deployment

## Overview

Vyn runs on **Vercel (Hobby plan)**: the Vite build is served as static files and `api/*.js`
as Node functions (`vercel.json`, legacy `builds` format). Production is
`https://www.projectvyn.dev`. Contracts live on Stellar testnet and are deployed separately
([contract migration](contracts/migration.md)). Plan limits and the function budget are in
[Vercel](integrations/vercel.md).

## Prerequisites

- Node.js 18 or newer (the API uses the global `fetch` and `AbortSignal.timeout`).
- For local API work: either the [Vercel CLI](https://vercel.com/docs/cli) (`vercel dev`) or
  the Express mirror in `backend/` (`npm install` inside `backend/`).
- The environment variables below.

## Local development

```bash
npm install
cp .env.example .env.local      # fill in the values; never commit it
npm run dev                     # Vite on http://localhost:8080
```

`vite.config.ts` proxies `/api/*` to `http://localhost:3000`. Two ways to serve it:

| Option | Command | Notes |
|---|---|---|
| Express mirror | `node backend/server.js` (reads `../.env.local`, then `../.env`) | Quick, but it has drifted: no `/api/blindpay` route (SPEI off-ramp returns `404`) and older validation. On-ramp and faucet reuse the real code. |
| Vercel dev | `vercel dev` (after `vercel link`) | Runs `api/` exactly as in production. Use this for SPEI work. |

Checks before a PR (see [contributing](contributing.md)):

```bash
npm test
npm run lint                               # main already has some errors; add none
npx tsc --noEmit -p tsconfig.app.json      # main has about 23 errors; add none
npm run build
npm run test:e2e                           # if you touched login, wallet or data loading
cd backend/contracts/<contract> && cargo test   # contract changes
```

## Production deployment

Vercel builds every push to `main` and promotes it to production; every PR gets a preview
URL. Manual deploy: `vercel --prod`.

| Source | Deployed as |
|---|---|
| `package.json` → `vite build` → `dist/` | Static site (SPA fallback to `index.html`) |
| `api/**/*.js` | 10 Node functions (Hobby limit: 12) |
| `api/_*.mjs`, `api/validation.mjs` | Bundled into the functions that import them |

Before merging anything that adds a file to `api/`, count:
`find api -name '*.js' | wc -l` must stay at 12 or less.

## Environment variables

Set them in Vercel → Project → Settings → Environment Variables, for **Production** and
**Preview**. Preview deployments then use the same testnet keys and BlindPay instance, so a
preview can move the same test funds as production.

### Server (never prefix with `VITE_`)

| Variable | Required | Read by |
|---|---|---|
| `SECRET_KEY_ADMIN` | yes | `evaluate-and-mint` (mint), `get-available-credit` (simulation source), `_usdc.mjs` (faucet and on-ramp settlement) |
| `STAKING_CONTRACT_ID` | yes | `_scoring-core.mjs` via `calculate-score`, `evaluate-and-mint`, `get-user-data` |
| `NFT_CONTRACT_ID` | yes | `evaluate-and-mint`, `get-available-credit` |
| `SUPABASE_URL` | yes in production | `_supabase.mjs` |
| `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_KEY`) | yes in production | `_supabase.mjs` |
| `BLINDPAY_API_KEY`, `BLINDPAY_INSTANCE_ID` | for SPEI | `_blindpay-core.mjs`, `_blindpay-onramp.mjs` |
| `BLINDPAY_DEMO_RECEIVER_ID` | for the on-ramp | `_blindpay-onramp.mjs` |
| `BLINDPAY_DEMO_BANK_ACCOUNT_ID` | for the off-ramp | `api/blindpay.js` |
| `BLINDPAY_PAYOUT_SECRET` | for the off-ramp | `_blindpay-core.mjs` |
| `BLINDPAY_BASE_URL` | no (default `https://api.blindpay.com/v1`) | BlindPay modules |
| `BLINDPAY_NETWORK`, `BLINDPAY_ONRAMP_NETWORK`, `BLINDPAY_TOKEN` | no (defaults `stellar_testnet`, `USDB`) | BlindPay modules |
| `BLINDPAY_PARTNER_FEE_ID` | no | BlindPay quotes |
| `FAUCET_USDC_AMOUNT` | no (default `2`) | `_faucet-core.mjs` |

### Frontend (compiled into the bundle, public)

| Variable | Required | Read by |
|---|---|---|
| `VITE_STAKING_CONTRACT_ID` | yes (same value as `STAKING_CONTRACT_ID`) | `src/stellar/contracts.ts` |
| `VITE_LENDING_CONTRACT_ID` | yes for credit | `src/stellar/contracts.ts`, `CreditSection` |
| `VITE_PRIVY_APP_ID` | yes for email login | `PrivyLayer` |
| `VITE_TREASURY_ADDRESS` | for the treasury tab | `src/stellar/contracts.ts`, `navItems.ts` |
| `VITE_WALLETCONNECT_PROJECT_ID` | no | `stellarWalletsKit.ts` |

`VITE_*` changes need a new deployment to take effect.

### Other

| Variable | Notes |
|---|---|
| `PORT` | Express mirror only (default 3000). |
| `MAX_REPLAY_EVENTS` | WebSocket hub, which is not deployed. |
| `KEEPALIVE_BASE_URL` | Optional GitHub **repository variable** for the Supabase keep-alive workflow. |
| `VERCEL_OIDC_TOKEN` | Injected by Vercel; don't set it. |
| `PUBLIC_KEY_ADMIN`, `BLINDPAY_PAYOUT_PUBLIC`, `BLINDPAY_WEBHOOK_SECRET` | Listed in `.env.example` but **not read** by any code. |

> ⚠️ `STAKING_CONTRACT_ID` and `VITE_STAKING_CONTRACT_ID` are mandatory and must hold the
> same ID. If the server one is missing, `calculate-score`, `get-user-data` and
> `evaluate-and-mint` answer `500` and the SBT mint hangs in the frontend.

## Scheduled jobs

| Job | Where | Schedule |
|---|---|---|
| Contracts CI (fmt, clippy, test, wasm build) | `.github/workflows/ci.yml` | Every push to `main` and every PR |
| Supabase keep-alive (`GET /api/readiness`) | `.github/workflows/supabase-keepalive.yml` | Minute 17 every 6 hours, and on demand |
| DeFindex keeper (`scripts/harvest_keeper.sh`) | Someone's machine | While it runs; not automated |

## Post-deploy checks

```bash
curl -s https://www.projectvyn.dev/api/health
curl -s https://www.projectvyn.dev/api/readiness     # expect checks.supabase = "ok"
```

More checks and common failures: [runbook](runbook.md).

## Rollback

1. **Vercel dashboard (fastest):** Deployments → last good deployment → ⋯ → **Promote to
   Production**.
2. **CLI:** `vercel ls`, then `vercel promote <deployment-url>`.
3. **Git:** `git revert <bad-commit>` and push to `main`; Vercel redeploys.

Rolling back the app doesn't roll back contracts or data in Supabase.

## Contract redeployment

None of the contracts has an `upgrade` function, so a new version means a new contract ID
(and, for `vinculo_sbt` and `staking_pool`, starting with empty state). After
`scripts/deploy_contracts.sh` prints the new IDs, update Vercel and redeploy:

| Contract | Variables to update |
|---|---|
| `staking_pool` | `STAKING_CONTRACT_ID` and `VITE_STAKING_CONTRACT_ID` |
| `vinculo_sbt` | `NFT_CONTRACT_ID` (and redeploy `vinculo_lending`, which stores the SBT address) |
| `vinculo_lending` | `VITE_LENDING_CONTRACT_ID` (then fund the pool from the treasury) |
| DeFindex vault | Nothing in Vercel; `staking_pool.set_vault` or a new pool ([DeFindex](integrations/defindex.md)) |

No contract ID is hard-coded in the app any more.
