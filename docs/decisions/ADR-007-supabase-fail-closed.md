---
tags: [adr, supabase, security]
status: accepted
date: 2026-11-02
files:
  - api/_supabase.mjs
  - api/_faucet-core.mjs
  - supabase/migrations/0001_baseline_close_access.sql
  - supabase/migrations/0002_ramp_schema.sql
  - supabase/migrations/0003_backfill.sql
---

# ADR-007: Supabase fails closed and reservations are atomic

ADR-004 to ADR-006 are on the contracts v2 branch, which has not been merged.

## Context

Supabase decides whether Vyn's admin account sends USDC, but three things let money out
when it failed:

- Without variables, `_supabase.mjs` used in-memory storage. On Vercel each instance has its
  own memory, so "once per wallet" and "once per payin" stopped being true.
- The faucet ignored errors from its check and sent USDC anyway.
- Checks were a read followed by a write, so two parallel calls could both pass (issue #92).

## Decision

- In production (`VERCEL_ENV=production`) the backend throws if Supabase is not configured.
  Local development and previews keep the in-memory store for the wallet mapping and payins,
  but anything that moves money needs Supabase in every environment.
- The faucet sends nothing if its check fails. A faucet that is down is better than an empty
  admin account.
- Only the secret key is accepted. The `SUPABASE_KEY` fallback is gone, because a publishable
  key can only work with policies that also open the tables to everyone.
- Limits are enforced in Postgres functions that check and reserve in one transaction,
  before the transfer.
- A reservation is released only by a declared failure. One that never finishes stays blocked
  and needs a manual review: the USDC may have been sent, and paying twice is worse than a
  delayed payment.
- The schema is versioned in `supabase/migrations` and tested on an embedded Postgres.

## Consequences

- If Supabase is down, the on-ramp and the faucet answer `503` until it returns.
- The old tables stay. Each endpoint moves to the new functions in its own PR (the on-ramp
  and the faucet already did), and the old tables are removed only after that.
- A send counts as a declared failure only if nothing can have gone out. A timeout from
  Horizon does not count, so that reservation also waits for a manual review.
- Migrations are applied by hand in the SQL Editor.

## Related

- [Supabase](../integrations/supabase.md) · [USDC faucet](../integrations/usdc-faucet.md)
