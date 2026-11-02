---
tags: [integration, supabase, backend]
updated: 2026-11-02
files:
  - api/_supabase.mjs
  - api/_faucet-core.mjs
  - api/_blindpay-onramp.mjs
  - api/readiness.js
  - .github/workflows/supabase-keepalive.yml
---

# Supabase

Small Postgres store used only by the backend, through Supabase's REST API (PostgREST).
It is **not** used for login or user profiles: auth was removed in June 2026 and Supabase came
back only to keep three idempotency and mapping tables for the faucet and the SPEI on-ramp.

## What it stores

| Table | Primary key | Written by | Purpose |
|---|---|---|---|
| `onramp_users` | `wallet_address` | `upsertOnrampUser` | Maps a Stellar address to its BlindPay receiver and blockchain wallet. |
| `faucet_claims` | `wallet_address` | `recordFaucetClaim` | One faucet claim per wallet. |
| `onramp_settlements` | `payin_id` | `recordSettlement` | One USDC settlement per BlindPay payin (with amount and tx hash). |

## Migrations

The schema lives in `supabase/migrations`. They are pasted into the SQL Editor of the
Supabase dashboard, in order, once each. `src/test/supabase-migrations.test.ts` runs them
on an embedded Postgres ([PGlite](https://pglite.dev)), so `npm test` covers the real SQL.

| File | What it does |
|---|---|
| `0001_baseline_close_access.sql` | The three tables above and the closed access. Safe to repeat. |
| `0002_ramp_schema.sql` | New tables and atomic functions. Runs once. The code does not use them yet. |
| `0003_backfill.sql` | Copies current rows to the new tables, without emails. Safe to repeat. |

New tables:

| Table | Purpose |
|---|---|
| `ramp_customers`, `ramp_payins` | Wallet ↔ BlindPay mapping, and each payin with its amount. |
| `ramp_settlements`, `ramp_payouts` | One settlement per payin, one payout per funding transaction. |
| `faucet_grants` | One grant per wallet, with a hashed IP for the daily limit. |
| `daily_budgets` | Amount spent per budget and UTC day, to enforce global caps. |
| `webhook_events` | Webhook deliveries already received. |
| `used_auth_challenges`, `rate_limits` | Session challenges already used, and hits per time window. |

Amounts are integer cents. `reserve_settlement` and `reserve_faucet` check limits and write
in one transaction, with a lock per wallet, before any money moves; `finish_*` closes the
reservation. Only a declared failure can be retried. A reservation that never finishes stays
blocked, because the USDC may have been sent, and needs a manual review. See
[ADR-007](../decisions/ADR-007-supabase-fail-closed.md).

## How it works

`api/_supabase.mjs` wraps `fetch` to `${SUPABASE_URL}/rest/v1/<table>` with the key in both
the `apikey` and `Authorization: Bearer` headers. Upserts use
`?on_conflict=<pk>` with `Prefer: resolution=merge-duplicates` (users) or
`resolution=ignore-duplicates` (claims, settlements).

| Function | Called from | Request |
|---|---|---|
| `getOnrampUserByWallet(address)` | `ensureBlockchainWallet` (`_blindpay-onramp.mjs`) | `GET onramp_users?wallet_address=eq.…&limit=1` |
| `upsertOnrampUser(row)` | `ensureBlockchainWallet` | `POST onramp_users?on_conflict=wallet_address` |
| `hasClaimedFaucet(address)` | `sendFaucetUsdc` (`_faucet-core.mjs`) | `GET faucet_claims?wallet_address=eq.…` |
| `recordFaucetClaim(address)` | `sendFaucetUsdc` | `POST faucet_claims?on_conflict=wallet_address` |
| `hasSettledPayin(payinId)` | `settlePayin` (`_blindpay-onramp.mjs`) | `GET onramp_settlements?payin_id=eq.…` |
| `recordSettlement(payinId, …)` | `settlePayin` | `POST onramp_settlements?on_conflict=payin_id` |
| `pingSupabase()` | `api/readiness.js` | `GET faucet_claims?select=claimed_at&limit=1` (5 s timeout) |
| `reserveSettlement`, `finishSettlement`, `reserveFaucet`, `finishFaucet`, `hitRateLimit`, `consumeAuthChallenge` | Nothing yet | `POST rpc/<function>` |

**Without configuration.** If `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing, the
table functions use an in-memory `Map`/`Set` so local development and previews keep working.
In production (`VERCEL_ENV=production`) they throw instead, because each function instance
would have its own memory and the same payment could go out twice. The `rpc` functions throw
in every environment. `/api/readiness` reports `"not_configured"` when the variables are
missing.

## Environment variables

| Variable | Where | Notes |
|---|---|---|
| `SUPABASE_URL` | Vercel (server only) | Project URL. A trailing `/` is stripped. |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (server only) | Secret key (`sb_secret_…`). Bypasses RLS, so the tables deny `anon`. |

Never prefix them with `VITE_`: they would end up in the browser bundle.

## Keeping the project awake

Supabase pauses Free plan projects that receive too little database activity in a 7-day
window, and "a few user requests to the database each day" usually prevents it
([Supabase: project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)).
A paused project can be resumed from the dashboard for 90 days.

Vyn's real traffic is too irregular to rely on, so:

1. `/api/readiness` calls `pingSupabase()`. It answers `200` with
   `checks.supabase: "ok"` (or `"not_configured"`), and `503` with `status: "not_ready"` and
   `checks.supabase: "error"` when Supabase fails or times out.
2. `.github/workflows/supabase-keepalive.yml` calls the production `/api/readiness` at
   minute 17 every 6 hours (4 queries a day) and fails unless `checks.supabase` is `"ok"`.
   GitHub emails the failure to whoever last edited the `cron` line. The repository variable
   `KEEPALIVE_BASE_URL` overrides the default URL. It can also be run by hand from the
   Actions tab (`workflow_dispatch`).

Why not Vercel Cron: on Hobby it runs at most once a day, anywhere within the hour, which is
below what Supabase recommends ([Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)).
Why not a new endpoint: the Vercel function budget is tight (see [Vercel](vercel.md)).

GitHub disables scheduled workflows in public repositories after 60 days without repository
activity ([GitHub docs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)).
If the repo goes quiet, re-enable it from the Actions tab.

## Failure modes

| Situation | What happens |
|---|---|
| Project paused or down | `pingSupabase` throws → readiness `503`, keep-alive job fails. Faucet and on-ramp throw → `502` to the client, no funds move. |
| Variables missing in production | Faucet and on-ramp answer `502`, no funds move. Readiness shows `"not_configured"`; the keep-alive job fails. |
| `recordFaucetClaim` fails after sending | USDC was already sent; the claim is not recorded, so the wallet can claim again. |
| `recordSettlement` fails after sending | USDC was already sent but the endpoint returns `502`; a retry sends it again. |
| Two `settle` calls at the same time | Both can pass `hasSettledPayin` before either records (issue #92). |

## Security notes

- Use the secret key on the server and keep RLS on, with no policies for `anon` or
  `authenticated`. A permissive policy makes these tables writable by anyone who has the
  publishable key, which would let them delete a settlement or claim row and repeat a payout.
- Until `settlePayin` moves to `reserve_settlement`, parallel `settle` calls can still both
  pass the check (issue #92).

## Related

- [BlindPay / SPEI](blindpay.md) · [USDC faucet](usdc-faucet.md) · [SPEI testing](../spei-testing.md)
