# WebSocket Streams — Durable Replay on Reconnect

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
