import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import handler, { consumeNonce } from "../../api/nonce.js";
import { consumeAuthNonce, resetNonceMemoryForTests } from "../../api/_supabase.mjs";

const WALLET = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

function createMockRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, any>,
    body: null as any,
    setHeader(k: string, v: any) {
      this.headers[k] = v;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

describe("Persistent auth nonces (/api/nonce)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetNonceMemoryForTests();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("issues a nonce, consumes it once, and rejects a second consume", async () => {
    const res = createMockRes();
    await handler({ method: "POST", body: { address: WALLET } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.nonce).toBe("string");

    const firstConsume = await consumeNonce(WALLET, res.body.nonce);
    expect(firstConsume).toBe(true);

    const secondConsume = await consumeNonce(WALLET, res.body.nonce);
    expect(secondConsume).toBe(false);
  });

  it("rejects expired or mismatched nonces", async () => {
    const res = createMockRes();
    await handler({ method: "POST", body: { address: WALLET } }, res);

    expect(await consumeNonce(WALLET, "wrong_nonce")).toBe(false);

    // Expired check (6 minutes in the future)
    const futureNow = Date.now() + 6 * 60 * 1000;
    expect(await consumeAuthNonce(WALLET, res.body.nonce, futureNow)).toBe(false);
  });

  it("persists and atomically consumes via Supabase and fails closed on store outage", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service_key";

    let storedConsumed = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init: any) => {
      if (init?.method === "POST") {
        return { ok: true, status: 201, text: async () => "" } as any;
      }
      if (init?.method === "PATCH") {
        if (!storedConsumed) {
          storedConsumed = true;
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify([{ nonce: "n1", consumed: true }]),
          } as any;
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([]),
        } as any;
      }
      return { ok: false, status: 500, text: async () => "error" } as any;
    });

    const res = createMockRes();
    await handler({ method: "POST", body: { address: WALLET } }, res);
    expect(res.statusCode).toBe(200);

    expect(await consumeNonce(WALLET, res.body.nonce)).toBe(true);
    expect(await consumeNonce(WALLET, res.body.nonce)).toBe(false);

    // Simulate Supabase outage -> fails closed
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Supabase down"));
    const outageRes = createMockRes();
    await handler({ method: "POST", body: { address: WALLET } }, outageRes);
    expect(outageRes.statusCode).toBe(503);
    expect(await consumeNonce(WALLET, res.body.nonce)).toBe(false);
  });
});
