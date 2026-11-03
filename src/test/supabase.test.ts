// @vitest-environment node
/**
 * Configuración de Supabase y llamadas a las funciones atómicas. El SQL de esas funciones
 * se prueba en supabase-migrations.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeAuthChallenge,
  finishFaucet,
  finishSettlement,
  getRampCustomer,
  getRampPayin,
  hasClaimedFaucet,
  hitRateLimit,
  isSupabaseConfigured,
  pingSupabase,
  reserveFaucet,
  reserveSettlement,
  saveRampPayin,
  upsertRampCustomer,
} from "../../api/_supabase.mjs";

const fetchMock = vi.fn();

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("_supabase", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co/");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    vi.stubEnv("VERCEL_ENV", "");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("configuration", () => {
    it("ignores the old publishable key variable", () => {
      vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
      vi.stubEnv("SUPABASE_KEY", "publishable-key");

      expect(isSupabaseConfigured()).toBe(false);
    });

    it("keeps the in-memory store outside production", async () => {
      vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
      vi.stubEnv("VERCEL_ENV", "preview");

      const row = { wallet_address: "GMEMORY" };
      await upsertRampCustomer(row);

      expect(await getRampCustomer("GMEMORY")).toEqual(row);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refuses the in-memory store in production", async () => {
      vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
      vi.stubEnv("VERCEL_ENV", "production");
      const row = { wallet_address: "GPROD" };

      await expect(getRampCustomer("GPROD")).rejects.toThrow(/producción/);
      await expect(upsertRampCustomer(row)).rejects.toThrow(/producción/);
      await expect(hasClaimedFaucet("GPROD")).rejects.toThrow(/producción/);
      await expect(getRampPayin("pi_1")).rejects.toThrow(/producción/);
      await expect(saveRampPayin({ payin_id: "pi_1" })).rejects.toThrow(/producción/);
    });

    it("marks failures so the API can answer 503", async () => {
      fetchMock.mockRejectedValueOnce(new Error("network down"));
      await expect(getRampPayin("pi_1")).rejects.toMatchObject({ code: "supabase_unavailable" });

      fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
      await expect(getRampPayin("pi_1")).rejects.toMatchObject({ code: "supabase_unavailable", status: 500 });
    });

    it("still lets readiness report the missing variables in production", async () => {
      vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
      vi.stubEnv("VERCEL_ENV", "production");

      expect(await pingSupabase()).toBe("not_configured");
    });
  });

  describe("atomic functions", () => {
    const lastCall = () => {
      const [url, options] = fetchMock.mock.calls[0];
      return { url, method: options.method, headers: options.headers, body: JSON.parse(options.body) };
    };

    it("reserves a settlement and returns the database answer", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse("reserved"));

      const result = await reserveSettlement({
        payinId: "pi_1",
        walletAddress: "GA",
        amountCents: 1000,
        walletDailyCapCents: 5000,
        globalDailyCapCents: 10000,
      });

      expect(result).toBe("reserved");
      expect(lastCall()).toMatchObject({
        url: "https://example.supabase.co/rest/v1/rpc/reserve_settlement",
        method: "POST",
        headers: { apikey: "service-key", Authorization: "Bearer service-key" },
        body: {
          p_payin_id: "pi_1",
          p_wallet: "GA",
          p_amount_cents: 1000,
          p_wallet_daily_cap_cents: 5000,
          p_global_daily_cap_cents: 10000,
        },
      });
    });

    it("finishes a settlement with null for what is missing", async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

      await finishSettlement("pi_1", { error: "horizon" });

      expect(lastCall().body).toEqual({ p_payin_id: "pi_1", p_tx_hash: null, p_error: "horizon" });
    });

    it("reserves and finishes a faucet grant", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse("ip_cap"));
      expect(
        await reserveFaucet({
          walletAddress: "GA",
          ipHash: "h",
          amountCents: 200,
          ipDailyMax: 2,
          globalDailyCapCents: 1000,
        })
      ).toBe("ip_cap");
      expect(lastCall().body).toEqual({
        p_wallet: "GA",
        p_ip_hash: "h",
        p_amount_cents: 200,
        p_ip_daily_max: 2,
        p_global_daily_cap_cents: 1000,
      });

      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await finishFaucet("GA");
      expect(lastCall().body).toEqual({ p_wallet: "GA", p_tx_hash: null });
    });

    it("returns the booleans of rate limits and challenges", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(false));
      expect(await hitRateLimit("ip:1", 3600, 5)).toBe(false);
      expect(lastCall().body).toEqual({ p_key: "ip:1", p_window_seconds: 3600, p_max: 5 });

      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(jsonResponse(true));
      expect(await consumeAuthChallenge("abc", "2026-11-02T00:00:00Z")).toBe(true);
      expect(lastCall().body).toEqual({ p_challenge_hash: "abc", p_expires_at: "2026-11-02T00:00:00Z" });
    });

    it("propagates database errors", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "function not found" }), { status: 404 })
      );

      await expect(hitRateLimit("ip:1", 60, 5)).rejects.toThrow("function not found");
    });

    it("refuses to run without Supabase, even in development", () => {
      vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

      expect(() => hitRateLimit("ip:1", 60, 5)).toThrow(/configurado/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
