# WebSocket Streams — Durable Replay on Reconnect

> **Status (2026-11-25):** the contracts publish events (issue #101), but the stream is
> still not deployed: no indexer writes `contract_events`, and there is no server or
> client. See [WebSocket integration](integrations/websocket.md).

## Contract events

Every state-changing function in the three contracts publishes exactly one Soroban
contract event with `env.events().publish`. The shape is the same in all of them:

- `topic[0]` — the action, a `Symbol` (`deposit`, `loan`, `mint`, …).
- `topic[1]` — the subject, the `Address` the action applies to (`user`, `admin`,
  `funder` or `treasury`).
- `data` — a small payload: one value or a tuple, listed below.

Amounts are `i128` in the token's smallest unit (USDC uses 7 decimals); timestamps are
Unix seconds. `mint`/`revoke` carry the tier (`0` means the wallet has no SBT).

### Topics and payloads

| Contract | `topic[0]` | `topic[1]` | `data` |
|---|---|---|---|
| `staking_pool` | `init` | admin | `(token: Address, vault: Address)` |
| `staking_pool` | `vault_set` | admin | `vault: Address` |
| `staking_pool` | `deposit` | user | `(amount: i128, shares: i128)` |
| `staking_pool` | `withdraw` | user | `(amount: i128, shares: i128)` |
| `vinculo_lending` | `init` | treasury | `(token: Address, sbt: Address)` |
| `vinculo_lending` | `pool_fund` | funder | `amount: i128` |
| `vinculo_lending` | `loan` | user | `(principal: i128, total_owed: i128, due_timestamp: u64)` |
| `vinculo_lending` | `repay` | user | `(amount: i128, remaining: i128)` |
| `vinculo_lending` | `interest_withdraw` | treasury | `amount: i128` |
| `vinculo_lending` | `pool_withdraw` | treasury | `amount: i128` |
| `vinculo_sbt` | `init` | admin | none (`()` / void) |
| `vinculo_sbt` | `mint` | user | `tier: u32` |
| `vinculo_sbt` | `revoke` | user | `previous_tier: u32` |

Field notes:

- `deposit.amount` is the token amount transferred in and `shares` the dfTokens minted
  by the DeFindex vault; `withdraw.amount` is what the user actually received and
  `shares` the dfTokens burned (both can differ from the requested amount because of
  vault rounding and yield).
- `loan` reports the disbursed principal, the total owed at maturity (principal + 5%
  interest) and the due timestamp; `repay.amount` is the amount actually applied and
  `remaining` the debt left (`0` when the loan is settled).
- The event is published in the same transaction as the storage change, so an indexer
  can treat it as the source of truth and never has to poll the getters.

### Example (decoded `deposit`)

```json
{
  "contract": "C...STAKING",
  "topics": ["deposit", "G...USER"],
  "data": [10000000, 10000000],
  "ledger": 1234567
}
```

An indexer maps this to a `contract_events` row (see
[`contractEventRepository.ts`](../src/db/repositories/contractEventRepository.ts)) and the
hub broadcasts it; the `payload` shape is up to the indexer, but keeping the fields above
makes the stream self-describing.

### Source of each event

| Contract source | Emitted events |
|---|---|
| `backend/contracts/staking_pool/src/lib.rs` | `init`, `vault_set`, `deposit`, `withdraw` |
| `backend/contracts/vinculo_lending/src/lib.rs` | `init`, `pool_fund`, `loan`, `repay`, `interest_withdraw`, `pool_withdraw` |
| `backend/contracts/vinculo_sbt/src/lib.rs` | `init`, `mint`, `revoke` |

Unit tests in each contract's `src/test.rs` assert the topics and payloads.

## Endpoint

```
GET /ws/streams
Upgrade: websocket
```

### Query parameters

| Parameter       | Type   | Required | Description                                                                 |
|-----------------|--------|----------|-----------------------------------------------------------------------------|
| `last_event_id` | number | No       | The `event_id` of the last event the client successfully processed. The server will replay all events with `event_id > last_event_id`. Defaults to `0` (full replay up to the cap) when absent or invalid. |

**Example upgrade URL**

```
wss://api.example.com/ws/streams?last_event_id=1042
```

---

## Message types

All messages are JSON objects with a `type` field.

### `replay`

Sent once per missed event during the replay phase, in ascending `event_id` order.

```json
{
  "type": "replay",
  "event": {
    "event_id": 1043,
    "payload": { "...": "..." },
    "created_at": "2026-05-30T18:00:00Z"
  }
}
```

### `replay_end`

Sent once after all replay messages. Signals that the client is now in live mode.

```json
{
  "type": "replay_end",
  "replay_truncated": false
}
```

`replay_truncated: true` means the gap exceeded `MAX_REPLAY_EVENTS` and some events were omitted. The client should treat its local state as potentially incomplete and consider a full re-sync.

### `live`

Sent for every new contract event that arrives after the replay phase.

```json
{
  "type": "live",
  "event": {
    "event_id": 1100,
    "payload": { "...": "..." },
    "created_at": "2026-05-30T18:05:00Z"
  }
}
```

---

## Reconnect flow

```
Client                              Server
  |                                   |
  |-- GET /ws/streams?last_event_id=N |
  |                                   |-- query contract_events WHERE event_id > N
  |<-- { type: "replay", event: ... } |   (up to MAX_REPLAY_EVENTS rows)
  |<-- { type: "replay", event: ... } |
  |<-- { type: "replay_end", ... }    |
  |                                   |
  |<-- { type: "live", event: ... }   |   (ongoing)
```

1. On every successful event the client should persist the latest `event_id` it has processed (e.g. in `localStorage` or a local DB).
2. On reconnect, pass that value as `last_event_id`.
3. Process all `replay` messages to fill the gap, then switch to live mode after `replay_end`.

---

## Configuration

| Environment variable | Default | Description                                                  |
|----------------------|---------|--------------------------------------------------------------|
| `MAX_REPLAY_EVENTS`  | `200`   | Maximum number of events returned in a single replay window. |

Set `MAX_REPLAY_EVENTS` in your `.env` / deployment config to tune the replay window for your workload.

---

## Security notes

- **Authentication** — Apply your existing auth middleware to the `/ws/streams` upgrade handler before calling `attachHub`. The hub itself does not perform authentication.
- **Input validation** — `last_event_id` is parsed as a non-negative integer. Any non-numeric, negative, or missing value is silently coerced to `0`.
- **Replay cap** — `MAX_REPLAY_EVENTS` prevents unbounded database reads from a malicious or misconfigured client supplying `last_event_id=0` on a large dataset.
- **No event filtering** — All events in the replay window are sent to the connected client. If events contain sensitive data, add row-level filtering in `getEventsSince` based on the authenticated user's identity.

---

## Source files

| File | Purpose |
|------|---------|
| `src/ws/hub.ts` | WebSocket hub — `attachHub`, `handleConnection`, `broadcast` |
| `src/db/repositories/contractEventRepository.ts` | `getEventsSince` DB query |
| `src/ws/hub.replay.test.ts` | Unit tests |
| `backend/contracts/*/src/lib.rs` | Contracts that publish the events above |
