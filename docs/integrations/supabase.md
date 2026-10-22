---
tags: [integration, supabase, backend]
updated: 2026-10-22
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

Only `onramp_users` has its `create table` statement in a code comment (`api/_supabase.mjs`).
The other two tables exist in the project but their DDL is not in the repo. There are no
migrations; if the project is recreated, the tables must be created by hand.

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

**Fallback without configuration.** If `SUPABASE_URL` or a key is missing, every function
uses an in-memory `Map`/`Set` instead. That keeps local development working, but on Vercel
each function instance has its own memory, so dedup and idempotency effectively disappear.
Production must have the variables set; `/api/readiness` reports `"not_configured"` when
they are missing.

## Environment variables

None of these are in `.env.example` yet (see [pending integrations](pending.md)).

| Variable | Where | Notes |
|---|---|---|
| `SUPABASE_URL` | Vercel (server only) | Project URL. A trailing `/` is stripped. |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (server only) | Preferred. Bypasses RLS, so the tables can deny `anon`. |
| `SUPABASE_KEY` | Vercel (server only) | Fallback (anon / publishable key). Only works if RLS policies let `anon` read and write. |

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
| Project paused or down | `pingSupabase` throws → readiness `503`, keep-alive job fails. Faucet: dedup check fails open (logs a warning and still sends USDC). On-ramp: `ensureBlockchainWallet` and `settlePayin` throw → `502` to the client, no funds move. |
| Variables missing in Vercel | Silent in-memory fallback (see above). Readiness shows `"not_configured"`; the keep-alive job fails. |
| `recordFaucetClaim` fails after sending | USDC was already sent; the claim is not recorded, so the wallet can claim again. |
| `recordSettlement` fails after sending | USDC was already sent but the endpoint returns `502`; a retry sends it again. |
| Two `settle` calls at the same time | Both can pass `hasSettledPayin` before either records (issue #92). |

## Security notes

- Use the service-role key on the server and keep RLS on, with no policies for `anon` or
  `authenticated`. A permissive policy makes these tables writable by anyone who has the
  publishable key, which would let them delete a settlement or claim row and repeat a payout.
- The reservation for settlements should be an insert that fails on conflict **before** the
  transfer, not a read followed by a write (issue #92).

## Related

- [BlindPay / SPEI](blindpay.md) · [USDC faucet](usdc-faucet.md) · [SPEI testing](../spei-testing.md)
