/**
 * hub.replay.test.ts
 *
 * Unit tests for the WebSocket replay bootstrap logic in src/ws/hub.ts.
 *
 * All external dependencies (DB, WebSocket) are replaced with lightweight
 * in-process doubles so no network or database is required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage } from "http";
import type { WebSocket, WebSocketServer } from "ws";
import {
  handleConnection,
  broadcast,
  MAX_REPLAY_EVENTS,
} from "./hub";
import type { DbClient, ContractEvent } from "../db/repositories/contractEventRepository";

// ── Test doubles ─────────────────────────────────────────────────────────────

function makeEvent(id: number): ContractEvent {
  return { event_id: id, payload: { id }, created_at: "2026-01-01T00:00:00Z" };
}

function makeDb(events: ContractEvent[]): DbClient {
  return {
    query: vi.fn().mockResolvedValue({ rows: events }),
  };
}

function makeWs(readyState = 1): { ws: WebSocket; sent: unknown[] } {
  const sent: unknown[] = [];
  const ws = {
    readyState,
    send: vi.fn((data: string) => sent.push(JSON.parse(data))),
    close: vi.fn(),
  } as unknown as WebSocket;
  return { ws, sent };
}

function makeReq(url: string): IncomingMessage {
  return { url } as IncomingMessage;
}

// ── handleConnection ──────────────────────────────────────────────────────────

describe("handleConnection", () => {
  it("sends replay events then replay_end when events exist", async () => {
    const events = [makeEvent(1), makeEvent(2), makeEvent(3)];
    const db = makeDb(events);
    const { ws, sent } = makeWs();

    await handleConnection(ws, makeReq("/ws/streams?last_event_id=0"), db);

    expect(sent).toHaveLength(4); // 3 replay + 1 replay_end
    expect(sent[0]).toEqual({ type: "replay", event: events[0] });
    expect(sent[1]).toEqual({ type: "replay", event: events[1] });
    expect(sent[2]).toEqual({ type: "replay", event: events[2] });
    expect(sent[3]).toEqual({ type: "replay_end", replay_truncated: false });
  });

  it("sends only replay_end with no events when history is empty", async () => {
    const db = makeDb([]);
    const { ws, sent } = makeWs();

    await handleConnection(ws, makeReq("/ws/streams?last_event_id=99"), db);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ type: "replay_end", replay_truncated: false });
  });

  it("passes last_event_id correctly to the DB query", async () => {
    const db = makeDb([]);
    const { ws } = makeWs();

    await handleConnection(ws, makeReq("/ws/streams?last_event_id=42"), db);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE event_id > $1"),
      [42, MAX_REPLAY_EVENTS + 1]
    );
  });

  it("defaults last_event_id to 0 when param is absent", async () => {
    const db = makeDb([]);
    const { ws } = makeWs();

    await handleConnection(ws, makeReq("/ws/streams"), db);

    expect(db.query).toHaveBeenCalledWith(
      expect.any(String),
      [0, MAX_REPLAY_EVENTS + 1]
    );
  });

  it("defaults last_event_id to 0 for non-numeric values", async () => {
    const db = makeDb([]);
    const { ws } = makeWs();

    await handleConnection(ws, makeReq("/ws/streams?last_event_id=abc"), db);

    expect(db.query).toHaveBeenCalledWith(expect.any(String), [0, expect.any(Number)]);
  });

  it("defaults last_event_id to 0 for negative values", async () => {
    const db = makeDb([]);
    const { ws } = makeWs();

    await handleConnection(ws, makeReq("/ws/streams?last_event_id=-5"), db);

    expect(db.query).toHaveBeenCalledWith(expect.any(String), [0, expect.any(Number)]);
  });

  it("sets replay_truncated=true and caps events when DB returns more than MAX_REPLAY_EVENTS", async () => {
    // Simulate DB returning MAX_REPLAY_EVENTS + 1 rows (the over-fetch sentinel)
    const events = Array.from({ length: MAX_REPLAY_EVENTS + 1 }, (_, i) =>
      makeEvent(i + 1)
    );
    const db = makeDb(events);
    const { ws, sent } = makeWs();

    await handleConnection(ws, makeReq("/ws/streams?last_event_id=0"), db);

    const replayMessages = sent.filter(
      (m) => (m as { type?: string }).type === "replay"
    );
    const endMessage = sent.find(
      (m) => (m as { type?: string }).type === "replay_end"
    ) as { replay_truncated?: boolean };

    expect(replayMessages).toHaveLength(MAX_REPLAY_EVENTS);
    expect(endMessage.replay_truncated).toBe(true);
  });

  it("does not send when WebSocket is not open (readyState !== 1)", async () => {
    const events = [makeEvent(1)];
    const db = makeDb(events);
    const { ws, sent } = makeWs(3 /* CLOSED */);

    await handleConnection(ws, makeReq("/ws/streams?last_event_id=0"), db);

    expect(sent).toHaveLength(0);
  });

  it("closes the socket on DB error", async () => {
    const db: DbClient = {
      query: vi.fn().mockRejectedValue(new Error("db down")),
    };
    const { ws } = makeWs();

    // handleConnection itself rejects; the caller (attachHub) closes the socket.
    await expect(
      handleConnection(ws, makeReq("/ws/streams"), db)
    ).rejects.toThrow("db down");
  });

  it("handles last_event_id at the boundary of available history (beyond max id)", async () => {
    // Client supplies an id higher than any stored event → empty replay
    const db = makeDb([]);
    const { ws, sent } = makeWs();

    await handleConnection(ws, makeReq("/ws/streams?last_event_id=999999"), db);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ type: "replay_end", replay_truncated: false });
  });

  it("replay events are ordered ascending by event_id", async () => {
    const events = [makeEvent(10), makeEvent(11), makeEvent(12)];
    const db = makeDb(events);
    const { ws, sent } = makeWs();

    await handleConnection(ws, makeReq("/ws/streams?last_event_id=9"), db);

    const replayMessages = sent.filter(
      (m) => (m as { type?: string }).type === "replay"
    ) as Array<{ event: { event_id: number } }>;
    const ids = replayMessages.map((m) => m.event.event_id);
    expect(ids).toEqual([10, 11, 12]);
  });
});

// ── broadcast ─────────────────────────────────────────────────────────────────

describe("broadcast", () => {
  it("sends a live message to all open clients", () => {
    const { ws: ws1, sent: sent1 } = makeWs(1);
    const { ws: ws2, sent: sent2 } = makeWs(1);
    const wss = {
      clients: new Set([ws1, ws2]),
    } as unknown as WebSocketServer;

    broadcast(wss, { foo: "bar" });

    expect(sent1[0]).toEqual({ type: "live", event: { foo: "bar" } });
    expect(sent2[0]).toEqual({ type: "live", event: { foo: "bar" } });
  });

  it("skips clients that are not open", () => {
    const { ws: openWs, sent: openSent } = makeWs(1);
    const { ws: closedWs, sent: closedSent } = makeWs(3);
    const wss = {
      clients: new Set([openWs, closedWs]),
    } as unknown as WebSocketServer;

    broadcast(wss, { x: 1 });

    expect(openSent).toHaveLength(1);
    expect(closedSent).toHaveLength(0);
  });

  it("does nothing when there are no clients", () => {
    const wss = { clients: new Set() } as unknown as WebSocketServer;
    expect(() => broadcast(wss, {})).not.toThrow();
  });
});

// ── getEventsSince (repository unit) ─────────────────────────────────────────

describe("getEventsSince", () => {
  it("queries with correct SQL and parameters", async () => {
    const { getEventsSince } = await import(
      "../db/repositories/contractEventRepository"
    );
    const db = makeDb([makeEvent(5)]);

    const result = await getEventsSince(db, 4, 10);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE event_id > $1"),
      [4, 10]
    );
    expect(result).toHaveLength(1);
    expect(result[0].event_id).toBe(5);
  });

  it("returns empty array when no events match", async () => {
    const { getEventsSince } = await import(
      "../db/repositories/contractEventRepository"
    );
    const db = makeDb([]);

    const result = await getEventsSince(db, 100, 50);

    expect(result).toEqual([]);
  });
});
