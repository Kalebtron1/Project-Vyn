import { beforeEach, describe, expect, it } from "vitest";
import type { ActivityItem } from "@/stellar/activity";
import {
  buildNotifications,
  initialNotificationState,
  readNotificationState,
  writeNotificationState,
} from "./notifications";

const item = (id: string, iso: string, overrides: Partial<ActivityItem> = {}): ActivityItem => ({
  id,
  txHash: `tx-${id}`,
  kind: "deposit",
  amount: 10,
  currency: "USDC",
  sign: "+",
  date: new Date(iso),
  ...overrides,
});

const older = item("1", "2026-11-01T10:00:00Z");
const newer = item("2", "2026-11-02T10:00:00Z", { kind: "savings_withdraw", amount: 4 });

describe("buildNotifications", () => {
  it("only reports real activity", () => {
    expect(buildNotifications([], null)).toEqual([]);
  });

  it("does not present previous history as new on first use", () => {
    const state = initialNotificationState([newer, older]);
    expect(buildNotifications([newer, older], state).every((n) => n.read)).toBe(true);
    expect(buildNotifications([newer, older], null).every((n) => n.read)).toBe(true);
  });

  it("marks what happens after the starting point as unread", () => {
    const state = initialNotificationState([older]);
    const [first, second] = buildNotifications([newer, older], state);
    expect(first).toMatchObject({ kind: "savings_withdraw", amount: 4, read: false });
    expect(second.read).toBe(true);
  });

  it("treats activity as new for a wallet that started with no history", () => {
    const state = initialNotificationState([]);
    expect(buildNotifications([older], state)[0].read).toBe(false);
  });

  it("respects read and dismissed ids", () => {
    const base = initialNotificationState([]);
    const [a, b] = buildNotifications([newer, older], base);
    const result = buildNotifications([newer, older], { ...base, readIds: [a.id], dismissedIds: [b.id] });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: a.id, read: true });
  });

  it("shows a repeated activity row once", () => {
    expect(buildNotifications([older, { ...older }], null)).toHaveLength(1);
  });
});

describe("notification state storage", () => {
  beforeEach(() => localStorage.clear());

  it("keeps each wallet apart", () => {
    const state = { readBefore: 5, readIds: ["a"], dismissedIds: [] };
    writeNotificationState("GA", state);
    expect(readNotificationState("GA")).toEqual(state);
    expect(readNotificationState("GB")).toBeNull();
  });

  it("ignores corrupt data", () => {
    localStorage.setItem("vinculo_notifications_GA", "{nope");
    expect(readNotificationState("GA")).toBeNull();
  });

  it("limits how many ids it keeps", () => {
    const ids = Array.from({ length: 300 }, (_, i) => String(i));
    writeNotificationState("GA", { readBefore: 0, readIds: ids, dismissedIds: [] });
    const saved = readNotificationState("GA");
    expect(saved?.readIds).toHaveLength(200);
    expect(saved?.readIds.at(-1)).toBe("299");
  });
});
