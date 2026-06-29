# Deployment

## Overview

Project Vyn is deployed on **Vercel**. The frontend is a static Vite build; the backend runs as Vercel Serverless Functions under `api/`. Routes are defined in `vercel.json`.

---

## Prerequisites

- Node.js ≥ 18
- [Vercel CLI](https://vercel.com/docs/cli) installed (`npm i -g vercel`)
- A Vercel project linked to this repository
- All required environment variables configured in the Vercel dashboard (see [Environment Variables](../README.md#environment-variables))

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in environment variables
cp .env.example .env.local
# Edit .env.local with your values

# 3. Start the frontend (Vite dev server on http://localhost:5173)
npm run dev

# 4. (Optional) Start the local Express backend in a separate terminal
#    Mirrors the Vercel serverless functions for offline testing
cd backend
node server.js
# Listening on http://localhost:3000
```

The frontend dev server proxies `/api/*` requests. If you need to test API routes locally without Vercel CLI, point your requests to `http://localhost:3000`.

---

## Production Deployment

Vercel deploys automatically on every push to `main`. To deploy manually:

```bash
# Deploy to production
vercel --prod
```

Vercel runs `npm run build` (`vite build`), places the output in `dist/`, and deploys the `api/` functions as serverless endpoints.

### What gets deployed

| Source | Deployed as |
|---|---|
| `dist/` (Vite output) | Static site |
| `api/*.js` | Vercel Serverless Functions |

### Environment variables in Vercel

Set these in **Vercel Dashboard → Project → Settings → Environment Variables**:

| Variable | Environment |
|---|---|
| `PUBLIC_KEY_ADMIN` | Production, Preview |
| `SECRET_KEY_ADMIN` | Production, Preview |
| `NFT_CONTRACT_ID` | Production, Preview |
| `STAKING_CONTRACT_ID` | Production, Preview |
| `VITE_STAKING_CONTRACT_ID` | Production, Preview |
| `VITE_LENDING_CONTRACT_ID` | Production, Preview |

> ⚠️ `STAKING_CONTRACT_ID` y `VITE_STAKING_CONTRACT_ID` son **obligatorias**: si faltan,
> `calculate-score`, `get-user-data` y `evaluate-and-mint` responden `500` y el minteo del
> SBT se queda colgado en el frontend. Deben coincidir con el contrato `staking_pool` desplegado.

`VERCEL_OIDC_TOKEN` is injected automatically by Vercel and does not need to be set manually.

---

## Preview Deployments

Every pull request gets an automatic preview URL from Vercel. Use it to verify changes before merging to `main`.

---

## Rollback

### Option 1 — Vercel dashboard (recommended)

1. Open **Vercel Dashboard → Project → Deployments**.
2. Find the last known-good deployment.
3. Click the three-dot menu → **Promote to Production**.

### Option 2 — Vercel CLI

```bash
# List recent deployments
vercel ls

# Promote a specific deployment URL to production
vercel promote <deployment-url>
```

### Option 3 — Git revert

```bash
# Revert the offending commit and push to main
git revert <bad-commit-sha>
git push origin main
# Vercel will automatically redeploy from the reverted state
```

---

## Build Verification

Before merging a PR, confirm the build passes locally:

```bash
npm run build
# Should complete without errors and produce dist/
```

Run the test suite:

```bash
npm test
```

---

## Contract Redeployment

If a Soroban contract is redeployed, update the corresponding environment variable in both `.env.local` and the Vercel dashboard, then redeploy:

| Contract | Variable to update |
|---|---|
| `vinculo_sbt` | `NFT_CONTRACT_ID` |
| `vinculo_lending` | `VITE_LENDING_CONTRACT_ID` |

The `staking_pool` contract ID is currently hardcoded in `api/get-user-data.js` and `src/stellar/contracts.ts`. Update both files if that contract is redeployed.
