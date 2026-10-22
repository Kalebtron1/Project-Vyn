---
tags: [integration, websocket, pending]
updated: 2026-10-22
prs: [62]
files:
  - src/ws/hub.ts
  - src/ws/hub.replay.test.ts
  - src/db/repositories/contractEventRepository.ts
  - docs/websocket.md
---

# WebSocket event stream (not connected)

**Status: library code only. Nothing in production serves, stores or consumes these
events.** The protocol itself (`replay`, `replay_end`, `live`, `last_event_id`) is described
in [WebSocket streams](../websocket.md).

## What exists

- `src/ws/hub.ts`: `attachHub({ db, wss })`, `handleConnection(ws, req, db)` and
  `broadcast(wss, event)`. On connect it replays rows with `event_id > last_event_id`, capped
  at `MAX_REPLAY_EVENTS` (default 200), then sends `replay_end`.
- `src/db/repositories/contractEventRepository.ts`: `getEventsSince(db, afterId, limit)`
  against a `contract_events` table, with a minimal `DbClient` interface.
- `src/ws/hub.replay.test.ts`: unit tests with fake sockets and DB. They run in `npm test`.

Added by PR #62 (May–June 2026) for a "durable replay on reconnect" issue.

## What is missing

| Piece | State |
|---|---|
| A server that accepts the `/ws/streams` upgrade | None. Vercel functions can't keep WebSocket connections open, and `backend/server.js` doesn't mount the hub. |
| The `ws` package | Only a transitive dependency; `hub.ts` imports its types only. |
| The `contract_events` table | Does not exist in the Supabase project (only the three tables in [Supabase](supabase.md)). |
| A producer of events | The contracts emit no Soroban events (issue #101) and no job ingests them. |
| A client | No frontend code opens a WebSocket. |
| Auth | The hub leaves it to the caller. |

## Environment variables

`MAX_REPLAY_EVENTS` (optional, default 200). Not in `.env.example`.

## Options

1. **Remove it** if live updates are not planned: the app refreshes after each action
   ([ADR-003](../decisions/ADR-003-no-polling-cache.md)), which covers today's needs.
2. **Finish it** outside Vercel functions: contracts emit events, an indexer (or Soroban
   RPC `getEvents` polled by a worker) writes `contract_events`, and a long-running server or
   a managed realtime service (for example Supabase Realtime on that table) pushes them.

## Related

- [Pending integrations](pending.md)
