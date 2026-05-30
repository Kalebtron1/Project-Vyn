/**
 * hub.ts — WebSocket connection hub with durable replay on reconnect.
 *
 * Upgrade endpoint: GET /ws/streams?last_event_id=<number>
 *
 * Reconnect flow:
 *  1. Client supplies `last_event_id` in the upgrade query string.
 *  2. Hub fetches all contract_events with event_id > last_event_id from the
 *     database (capped at MAX_REPLAY_EVENTS).
 *  3. Each missed event is sent as a `replay` message.
 *  4. If the window was truncated a `replay_truncated` flag is set to true in
 *     the final `replay_end` message.
 *  5. The client then receives live events via `broadcast()`.
 *
 * Security:
 *  - last_event_id is validated as a non-negative integer; invalid values
 *    default to 0 (full replay up to the cap).
 *  - MAX_REPLAY_EVENTS is configurable via the MAX_REPLAY_EVENTS env var and
 *    defaults to 200, preventing unbounded DB reads.
 *  - No authentication is added here; callers should apply auth middleware
 *    before calling `handleUpgrade`.
 */

import type { IncomingMessage } from "http";
import type { WebSocket, WebSocketServer } from "ws";
import type { DbClient } from "../db/repositories/contractEventRepository";
import { getEventsSince } from "../db/repositories/contractEventRepository";

export const MAX_REPLAY_EVENTS: number =
  Number(
    typeof process !== "undefined" && process.env?.MAX_REPLAY_EVENTS
      ? process.env.MAX_REPLAY_EVENTS
      : 200
  ) || 200;

export interface HubDeps {
  db: DbClient;
  wss: WebSocketServer;
}

/** Wire the hub onto an existing WebSocketServer instance. */
export function attachHub(deps: HubDeps): void {
  deps.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    handleConnection(ws, req, deps.db).catch((err) => {
      console.error("[hub] connection error", err);
      ws.close(1011, "internal error");
    });
  });
}

/** Exported for unit testing without a real WebSocketServer. */
export async function handleConnection(
  ws: WebSocket,
  req: IncomingMessage,
  db: DbClient
): Promise<void> {
  const lastEventId = parseLastEventId(req.url ?? "");

  // ── Replay phase ──────────────────────────────────────────────────────────
  // Fetch one extra row beyond the cap to detect truncation without a COUNT.
  const fetchLimit = MAX_REPLAY_EVENTS + 1;
  const events = await getEventsSince(db, lastEventId, fetchLimit);

  const truncated = events.length > MAX_REPLAY_EVENTS;
  const replayEvents = truncated ? events.slice(0, MAX_REPLAY_EVENTS) : events;

  for (const event of replayEvents) {
    send(ws, { type: "replay", event });
  }

  send(ws, { type: "replay_end", replay_truncated: truncated });

  // ── Live phase ────────────────────────────────────────────────────────────
  // The connection stays open; live events are pushed via broadcast().
}

/**
 * Broadcast a live event to all connected clients.
 * Call this whenever a new contract_event is persisted.
 */
export function broadcast(wss: WebSocketServer, event: unknown): void {
  const payload = JSON.stringify({ type: "live", event });
  wss.clients.forEach((client) => {
    if (client.readyState === 1 /* OPEN */) {
      client.send(payload);
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseLastEventId(url: string): number {
  try {
    // url may be a path+query string like "/ws/streams?last_event_id=42"
    const search = url.includes("?") ? url.slice(url.indexOf("?")) : "";
    const params = new URLSearchParams(search);
    const raw = params.get("last_event_id");
    if (raw === null) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function send(ws: WebSocket, data: unknown): void {
  if (ws.readyState === 1 /* OPEN */) {
    ws.send(JSON.stringify(data));
  }
}
