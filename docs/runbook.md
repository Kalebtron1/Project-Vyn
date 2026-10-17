# Incident Runbook

Use this document during an incident or deploy. For full setup instructions see [deployment.md](deployment.md). For flow walkthroughs see [flows.md](flows.md).

---

## Production URLs

| Resource | URL |
|---|---|
| App | `https://<your-vercel-project>.vercel.app` |
| Health check | `https://<your-vercel-project>.vercel.app/api/health` |
| Readiness check | `https://<your-vercel-project>.vercel.app/api/readiness` |
| Vercel dashboard | `https://vercel.com/dashboard` |

Replace `<your-vercel-project>` with the actual Vercel project slug.

---

## Normal Deploy Path

Vercel deploys automatically on every push to `main`. To deploy manually:

```bash
vercel --prod
```

What happens:
1. Vercel runs `npm run build` (`vite build`) and writes output to `dist/`.
2. `dist/` is deployed as the static frontend.
3. `api/*.js` files are deployed as Serverless Functions.
4. Routes defined in `vercel.json` are applied.

> ⚠️ Production-only step: the automatic deploy on push to `main` cannot be replicated locally. Use `vercel --prod` for a manual equivalent, which requires the Vercel CLI and a linked project.

---

## Post-Deploy Verification

Run these checks immediately after any production deploy.

### 1. Health endpoints

```bash
curl -s https://<your-vercel-project>.vercel.app/api/health
# Expected: {"status":"ok"} or similar

curl -s https://<your-vercel-project>.vercel.app/api/readiness
# Expected: {"status":"ready"} or similar
```

Locally (requires `backend/server.js` running on port 3000):

```bash
npm run check:health
```

### 2. Frontend loads

Open the production URL in a browser. Confirm:
- The app loads without a blank screen or console errors.
- The wallet connect button is visible on `/login`.

### 3. Critical API routes

```bash
# Score calculation
curl -s -X POST https://<your-vercel-project>.vercel.app/api/calculate-score \
  -H "Content-Type: application/json" \
  -d '{"address":"G...","totalDeposited":0}'
# Expected: JSON with a score field, not a 500.

# Available credit
curl -s -X POST https://<your-vercel-project>.vercel.app/api/get-available-credit \
  -H "Content-Type: application/json" \
  -d '{"userAddress":"G..."}'
# Expected: JSON with tier and availableCredit fields, not a 500.
```

### 4. Environment variables present

If any API route returns `500`, check the Vercel dashboard for missing env vars:

| Variable | Used by |
|---|---|
| `PUBLIC_KEY_ADMIN` | All API functions that sign transactions |
| `SECRET_KEY_ADMIN` | All API functions that sign transactions |
| `NFT_CONTRACT_ID` | `evaluate-and-mint` |
| `STAKING_CONTRACT_ID` | `get-user-data`, `evaluate-and-mint`, `calculate-score` |
| `VITE_STAKING_CONTRACT_ID` | Frontend (`src/stellar/contracts.ts`) |
| `VITE_LENDING_CONTRACT_ID` | Frontend |

`STAKING_CONTRACT_ID` and `VITE_STAKING_CONTRACT_ID` must hold the **same** contract ID. There is no fallback — a missing value returns a `500`.

> See [deployment.md — Environment variables in Vercel](deployment.md#environment-variables-in-vercel) for the full variable list.

---

## Rollback

### Option 1 — Vercel dashboard (fastest, no CLI needed)

1. Open Vercel Dashboard → Project → Deployments.
2. Find the last known-good deployment.
3. Click the three-dot menu → **Promote to Production**.

### Option 2 — Vercel CLI

```bash
# List recent deployments
vercel ls

# Promote a known-good deployment URL to production
vercel promote <deployment-url>
```

### Option 3 — Git revert

```bash
git revert <bad-commit-sha>
git push origin main
# Vercel redeploys automatically from the reverted state
```

After any rollback, re-run the [post-deploy verification](#post-deploy-verification) steps above.

---

## Common Failure Scenarios

### Blank screen / app fails to load

- Check the Vercel deployment log for build errors.
- Confirm `npm run build` passes locally: `npm run build`.
- Check browser console for missing env var errors (`VITE_*` variables must be set at build time).

### `/api/*` returns 500

- Open Vercel Dashboard → Functions → check the function log for the failing endpoint.
- Confirm all required env vars are set (see table above).
- The most common cause is a missing `STAKING_CONTRACT_ID` or `SECRET_KEY_ADMIN`.

### Wallet connect fails

- Confirm the user has Freighter (desktop) or Albedo (mobile) installed.
- Check that `VITE_STAKING_CONTRACT_ID` and `VITE_LENDING_CONTRACT_ID` are set — the frontend reads these at startup.
- See [flows.md — Authentication](flows.md#1-authentication-and-wallet-setup) for the full auth flow.

### NFT/SBT minting stuck

- The mint flow calls `POST /api/evaluate-and-mint`.
- Check the function log for a `STAKING_CONTRACT_ID` or `NFT_CONTRACT_ID` error.
- If either contract was redeployed, update the corresponding env var in Vercel and redeploy. See [deployment.md — Contract Redeployment](deployment.md#contract-redeployment).

### Deposit or loan transaction fails

- These are on-chain transactions signed by the user's wallet (Freighter/Albedo) — the backend does not sign them.
- Confirm the user has enough XLM for fees.
- Confirm `VITE_STAKING_CONTRACT_ID` and `VITE_LENDING_CONTRACT_ID` match the deployed contracts.

---

## Contact Points

| Role | Contact |
|---|---|
| Vercel project owner | Add your team contact here |
| Stellar/Soroban admin keys owner | Add your team contact here |
| BlindPay account owner | Add your team contact here |

> Fill in the table above with actual names and handles before going to production.

---

## Related Documents

- [Deployment guide](deployment.md) — full local setup, Vercel deploy, and contract redeployment steps.
- [Core flows](flows.md) — step-by-step walkthroughs of auth, deposit, scoring/minting, credit, and loan flows.
- [Architecture overview](architecture.md) — layers, components, and contracts.
- [API reference](api.md) — all endpoint contracts with request/response shapes and error codes.
- [Contract migration guide](contracts/migration.md) — reproducible deploy, upgrade, and rollback steps for all three Soroban contracts.

Closes #37
