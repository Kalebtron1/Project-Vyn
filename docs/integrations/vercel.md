---
tags: [integration, vercel, deployment, limits]
updated: 2026-10-22
files:
  - vercel.json
  - api/
  - vite.config.ts
  - .github/workflows/supabase-keepalive.yml
---

# Vercel

Vercel hosts the static frontend and runs the `api/` folder as Node.js functions. The project
is on the **Hobby** plan. Production is `https://www.projectvyn.dev`; the apex domain
redirects to `www` with a `308`. Every push to `main` deploys to production and every PR gets
a preview URL.

## How `vercel.json` builds the project

`vercel.json` uses the legacy `builds` + `routes` format:

| Build | Source | Output |
|---|---|---|
| `@vercel/static-build` | `package.json` (`vite build`) | `dist/` as static files |
| `@vercel/node` | glob `api/**/*.js` | One function per matching file |

Routes send `/api/<name>` to `/api/<name>.js` and everything else to `index.html` (SPA).
Headers on every path: a `Content-Security-Policy` (scripts, styles and connections allowed
to any `https:`/`wss:` origin, `frame-ancestors 'self'`) and
`Cross-Origin-Opener-Policy: same-origin-allow-popups` for Privy's OAuth popups.

Vercel recommends against `builds` and suggests the `functions` property instead; the two
can't be combined ([vercel.json reference](https://vercel.com/docs/project-configuration/vercel-json#builds),
[error list](https://vercel.com/docs/errors/error-list#conflicting-functions-and-builds-configuration)).

## Function count today: 10 of 12

| # | File | Called by | Notes |
|---|---|---|---|
| 1 | `blindpay.js` | Retiros (SPEI off-ramp) | `action`: quote, payout, status |
| 2 | `calculate-score.js` | `useScore`, Perfil, `evaluate-and-mint` (over HTTP) | `maxDuration: 60` |
| 3 | `evaluate-and-mint.js` | Perfil | `maxDuration: 60` |
| 4 | `faucet-usdc.js` | Perfil | |
| 5 | `get-available-credit.js` | `useCredit`, Perfil | |
| 6 | `get-user-data.js` | **nobody** | Legacy |
| 7 | `health.js` | Deploy checks | |
| 8 | `nonce.js` | **nobody** | Legacy, see [pending](pending.md) |
| 9 | `onramp.js` | Depositar, Login | `action`: init, quote, payin, status, settle |
| 10 | `readiness.js` | Supabase keep-alive workflow, deploy checks | Pings Supabase |

**Not functions** (shared code bundled into the functions that import it):
`_blindpay-core.mjs`, `_blindpay-onramp.mjs`, `_faucet-core.mjs`, `_logger.mjs`,
`_scoring-core.mjs`, `_supabase.mjs`, `_usdc.mjs` and `validation.mjs`.

Why they don't count, and the trap:

1. With the current `builds` entry, only files matching `api/**/*.js` become functions.
   `.mjs` files never match, whatever their name.
2. Without `builds` (zero-config), Vercel turns every supported file in `api/` into a
   function, **except** names starting with `_` or `.` and files ending in `.d.ts`
   ([advanced configuration](https://vercel.com/docs/functions/configuring-functions/advanced-configuration)).
   `.mjs` is a supported Node.js entry point, so **`validation.mjs` would become an 11th
   function**. Rename it to `_validation.mjs` before dropping `builds`.

Rule for new code: shared helpers go in `api/_<name>.mjs`; that is safe under both modes.

To count: `find api -name '*.js' | wc -l` (today `10`). The build fails with
"No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan" when
the limit is crossed.

History: on 2026-06-28 the SPEI work added 17 functions and the deploy failed. Commit
`b786e94` merged `blindpay-quote/payout/status` into `blindpay.js`, the four `onramp-*` files
into `onramp.js`, and renamed `_logger.js` and `validation.js` to `.mjs`, leaving 10.

## Hobby plan limits (checked on 2026-10-22)

From Vercel's docs ([limits](https://vercel.com/docs/limits), updated 2026-09-16;
[Hobby plan](https://vercel.com/docs/plans/hobby), 2026-09-14;
[runtimes](https://vercel.com/docs/functions/runtimes#functions-created-per-deployment),
2026-08-12; [functions limitations](https://vercel.com/docs/functions/limitations),
2026-08-24; [cron jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing), 2026-07-15):

| Limit | Hobby |
|---|---|
| Functions per deployment | 12 when using functions without a framework (one file in `api/` = one function). Next.js/SvelteKit bundle routes and rarely hit it. |
| Max duration (Fluid compute) | 300 s default and maximum |
| Memory / CPU | 2 GB / 1 vCPU |
| Request or response body | 4.5 MB |
| Function bundle size | 250 MB uncompressed |
| Deployments per day | 100 |
| Builds per hour | 100, and "each Vercel Function is also classed as a build" |
| Concurrent builds | 1 |
| Build time | 45 min |
| Runtime logs kept | 1 hour |
| Cron jobs | Once per day each, ±59 min |
| Included per month | 1,000,000 function invocations; 4 h Active CPU; 360 GB-h provisioned memory; 100 GB Fast Data Transfer; 10 GB Fast Origin Transfer; 1,000,000 CDN requests |
| Over the included usage | The feature is paused, in most cases until 30 days have passed |
| Use | Non-commercial, personal use only |

Margin: **2 functions**, plenty of usage for current traffic, and a 1-hour log window
that makes incidents hard to investigate after the fact.

### Duration note

Fluid compute is on by default for projects created after 2025-04-23 (check
Settings → Functions). With it, the Hobby default is already 300 s, so the
`export const config = { maxDuration: 60 }` in `calculate-score.js` and
`evaluate-and-mint.js` (written when 60 s was the Hobby maximum) now **lowers** their limit.
The mint chains a call to `calculate-score`, `prepareTransaction` and up to 45 s of
confirmation polling, so it can approach 60 s.

## Environment variables

Set in Vercel → Project → Settings → Environment Variables. The full list, with where each
one is read, is in [Deployment](../deployment.md#environment-variables). `VITE_*` values are
compiled into the frontend at build time: change them and redeploy.

## If the function limit is reached

In order of cost:

1. **Delete the two unused functions**, `nonce.js` and `get-user-data.js` (no caller in the
   frontend). Frees 2.
2. **Merge `health.js` into `readiness.js`** (for example `GET /api/readiness?deep=0` for a
   shallow check) and update `scripts/healthcheck.js` and the runbook. Frees 1.
3. **Add actions, not files**: new endpoints in an existing domain go behind `?action=`
   (as `blindpay.js` and `onramp.js` do). A future BlindPay webhook can be
   `/api/blindpay?action=webhook`.
4. **One router function** (`api/index.js` dispatching on the path) if the API keeps
   growing. Watch cold starts and bundle size.
5. **Move to Pro** ($20 per developer per month): no function limit, up to 800 s duration,
   and commercial use is allowed. Needed anyway before real users and real money.

## Failure modes

| Failure | Where it shows |
|---|---|
| Too many functions | Build fails with the message above; production keeps the previous deployment. |
| Missing env var | The function answers `500`/`502` with the variable's name (most handlers check), or reads return zeros. See the [runbook](../runbook.md). |
| Timeout | `504 FUNCTION_INVOCATION_TIMEOUT`; the mint UI shows an error. |
| Usage over the Hobby allowance | Vercel pauses the feature or deployment. |

## Related

- [Deployment](../deployment.md) · [Runbook](../runbook.md) · [Supabase keep-alive](supabase.md#keeping-the-project-awake)
