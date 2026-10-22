// @vitest-environment node
/**
 * /api/readiness — comprueba Supabase con una lectura mínima.
 *
 * El workflow `supabase-keepalive` llama a este endpoint cada 6 h: la lectura cuenta
 * como actividad (evita que Supabase pause el proyecto Free) y un 503 avisa que
 * Supabase no responde.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../../api/readiness.js";

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, unknown>,
    setHeader(key: string, value: unknown) {
      res.headers[key] = value;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY"] as const;
const savedEnv: Record<string, string | undefined> = {};

describe("GET /api/readiness", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is ready and reports not_configured when Supabase variables are missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = mockRes();

    await handler({ method: "GET", headers: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: "ready", checks: { supabase: "not_configured" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads one row from Supabase and is ready when it answers", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co/";
    process.env.SUPABASE_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = mockRes();

    await handler({ method: "GET", headers: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: "ready", checks: { supabase: "ok" } });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/faucet_claims?select=claimed_at&limit=1",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("returns 503 when Supabase fails (e.g. a paused project)", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    const res = mockRes();

    await handler({ method: "GET", headers: {} }, res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ status: "not_ready", checks: { supabase: "error" } });
  });

  it("rejects non-GET requests", async () => {
    const res = mockRes();

    await handler({ method: "POST", headers: {} }, res);

    expect(res.statusCode).toBe(405);
  });
});
