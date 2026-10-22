---
tags: [adr, performance, data]
status: accepted
date: 2026-10-22
prs: [138]
files:
  - src/lib/queryClient.ts
  - src/lib/chainData.ts
  - src/stellar/queries.ts
  - src/components/AppShell.tsx
---

# ADR-003: Cache on-chain reads, no polling

## Context

Each card on the home screen read its own data and polled it every 5–20 s. Credit was
requested by three cards and score by two. The home screen made 13 requests on load and 25
more every 20 s, while the data only changes when the user makes a transaction.

## Decision

- All on-chain and API reads go through React Query hooks in `src/lib/chainData.ts`:
  `useSavings`, `useYield`, `useCredit`, `useScore`, `useActivity`, `useTreasury`.
- Keys live under `["chain", wallet, ...]` (`chainKeys` in `src/lib/queryClient.ts`).
  Cards that show the same data share one request.
- Data is fresh for 60 s (`STALE_MS`). It is read again when the user returns to the tab
  or opens a page after that. **No `refetchInterval`, no `setInterval`.**
- After an action that changes data (deposit, withdrawal, loan, repayment, SBT mint,
  treasury action):
  1. Wait for the transaction to be confirmed (`waitForConfirmation`). Otherwise the
     network still returns the old values.
  2. Call `useRefreshChainData()(address)`. It refreshes the wallet's data immediately, and
     history and score once more after 6 s (`HORIZON_LAG_MS`), because Horizon indexes new
     transactions with a delay.
- `readSavingsSnapshot` reads the account once and runs the three contract simulations in
  parallel. It throws on network errors so React Query can retry, instead of returning 0.
- Feedback: skeletons on the first load, and the header shows "Actualizando…" /
  "Updating…" (`data-testid="chain-syncing"`) while any read is in flight.

## Consequences

- Home: 4 requests on load, 0 afterwards (checked in `e2e/data-loading.spec.ts`).
- New screens that show on-chain data must use these hooks, not their own `useEffect` +
  `fetch`, or the polling problem comes back.
- New actions that change data must call `useRefreshChainData` after confirmation, or the
  UI shows stale values for up to 60 s.
- The legacy `fetch*` helpers in `src/stellar/queries.ts` still return 0 on error, for old
  callers. New code should use the hooks.
