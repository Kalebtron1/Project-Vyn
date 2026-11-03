// @vitest-environment node
/**
 * Faucet de punta a punta: el handler real, con el envío simulado y las llamadas a Supabase
 * resueltas contra las migraciones reales en un Postgres embebido.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../../api/faucet-usdc.js";
import { clientIp } from "../../api/_faucet-core.mjs";

const { sendUsdcFromAdmin, usdcBalance } = vi.hoisted(() => ({
  sendUsdcFromAdmin: vi.fn(),
  usdcBalance: vi.fn(),
}));
vi.mock("../../api/_usdc.mjs", () => ({
  HORIZON_URL: "https://horizon-testnet.stellar.org",
  usdcBalance,
  sendUsdcFromAdmin,
}));

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const wallet = (letter: string) => `G${letter.repeat(55)}`;
const WALLET = wallet("A");

let db: PGlite;
let supabaseDown: boolean;

async function fakeFetch(input: RequestInfo | URL, options: RequestInit = {}) {
  if (supabaseDown) return new Response("", { status: 503 });
  const path = String(input).replace("https://db.test/rest/v1/", "");
  if (path.startsWith("rpc/")) {
    const body = JSON.parse(String(options.body));
    const names = Object.keys(body);
    const args = names.map((name, i) => `${name} => $${i + 1}`).join(", ");
    const { rows } = await db.query<{ result: unknown }>(
      `select public.${path.slice(4).split("?")[0]}(${args}) as result`,
      names.map((name) => body[name])
    );
    return new Response(rows[0].result == null ? null : JSON.stringify(rows[0].result), { status: 200 });
  }
  const address = decodeURIComponent(path.match(/wallet_address=eq\.([^&]+)/)![1]);
  const { rows } = await db.query("select wallet_address from public.faucet_claims where wallet_address = $1", [address]);
  return new Response(JSON.stringify(rows), { status: 200 });
}

async function claim(address = WALLET, ip = "1.1.1.1") {
  const res = {
    statusCode: 0,
    body: null as Record<string, unknown> | null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      this.body = payload;
      return this;
    },
  };
  await handler({ method: "POST", body: { address }, headers: { "x-vercel-forwarded-for": ip } }, res);
  return res;
}

const grant = async (address = WALLET) => {
  const { rows } = await db.query<{ status: string; tx_hash: string | null; ip_hash: string }>(
    "select status, tx_hash, ip_hash from public.faucet_grants where wallet_address = $1",
    [address]
  );
  return rows[0];
};

const spent = async () => {
  const { rows } = await db.query<{ total: string }>(
    "select coalesce(sum(spent_cents), 0)::text as total from public.daily_budgets where budget = 'faucet'"
  );
  return Number(rows[0].total);
};

beforeEach(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (const file of readdirSync(MIGRATIONS).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  supabaseDown = false;
  vi.stubEnv("SUPABASE_URL", "https://db.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.stubEnv("FAUCET_IP_SALT", "test-salt");
  vi.stubEnv("FAUCET_USDC_AMOUNT", "2");
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  let sent = 0;
  sendUsdcFromAdmin.mockReset().mockImplementation(async () => `hash_${++sent}`);
  usdcBalance.mockReset().mockResolvedValue(0);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("faucet", () => {
  it("sends once and records the grant with a hashed IP", async () => {
    const res = await claim();

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ sent: true, hash: "hash_1", amount: "2" });
    expect(sendUsdcFromAdmin).toHaveBeenCalledWith({ to: WALLET, amount: "2" });
    const row = await grant();
    expect(row).toMatchObject({ status: "sent", tx_hash: "hash_1" });
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.ip_hash).not.toContain("1.1.1.1");
    expect(await spent()).toBe(200);
  });

  it("sends once when the same wallet claims in parallel", async () => {
    const results = await Promise.all([claim(), claim()]);

    expect(sendUsdcFromAdmin).toHaveBeenCalledOnce();
    expect(results.filter((r) => r.body!.sent === true)).toHaveLength(1);
    expect(results.find((r) => r.body!.sent === false)!.body).toMatchObject({ reason: "already_claimed" });
  });

  it("answers already_claimed on a repeat", async () => {
    await claim();

    const res = await claim();

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ sent: false, reason: "already_claimed" });
    expect(sendUsdcFromAdmin).toHaveBeenCalledOnce();
  });

  it("does not pay a wallet that only appears in the old table", async () => {
    await db.query("insert into public.faucet_claims (wallet_address) values ($1)", [WALLET]);

    expect((await claim()).body).toEqual({ sent: false, reason: "already_claimed" });
    expect(sendUsdcFromAdmin).not.toHaveBeenCalled();
  });

  it("answers 429 from the same IP over its daily limit", async () => {
    vi.stubEnv("FAUCET_IP_DAILY_MAX", "2");
    await claim(wallet("A"));
    await claim(wallet("B"));

    const res = await claim(wallet("C"));

    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ sent: false, reason: "ip_cap" });
    expect(sendUsdcFromAdmin).toHaveBeenCalledTimes(2);
    expect((await claim(wallet("C"), "2.2.2.2")).statusCode).toBe(200);
  });

  it("answers 429 when the daily budget runs out", async () => {
    vi.stubEnv("FAUCET_DAILY_BUDGET_USD_CENTS", "300");
    await claim(wallet("A"), "1.1.1.1");

    const res = await claim(wallet("B"), "2.2.2.2");

    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ sent: false, reason: "global_cap" });
    expect(sendUsdcFromAdmin).toHaveBeenCalledOnce();
    expect(await spent()).toBe(200);
  });

  it("answers 503 and sends nothing when Supabase is down", async () => {
    supabaseDown = true;

    expect((await claim()).statusCode).toBe(503);
    expect(sendUsdcFromAdmin).not.toHaveBeenCalled();
  });

  it("answers 503 and sends nothing when production has no Supabase", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("VERCEL_ENV", "production");

    expect((await claim()).statusCode).toBe(503);
    expect(sendUsdcFromAdmin).not.toHaveBeenCalled();
  });

  it("answers 503 and sends nothing without the salt", async () => {
    vi.stubEnv("FAUCET_IP_SALT", "");

    expect((await claim()).statusCode).toBe(503);
    expect(sendUsdcFromAdmin).not.toHaveBeenCalled();
  });

  it("answers 503 and sends nothing with an invalid amount", async () => {
    vi.stubEnv("FAUCET_USDC_AMOUNT", "abc");

    expect((await claim()).statusCode).toBe(503);
    expect(sendUsdcFromAdmin).not.toHaveBeenCalled();
  });

  it("frees the wallet and the budget when the send declared that it failed", async () => {
    sendUsdcFromAdmin.mockRejectedValueOnce(Object.assign(new Error("Horizon: op_underfunded"), { notSent: true }));

    expect((await claim()).statusCode).toBe(502);
    expect((await grant()).status).toBe("failed");
    expect(await spent()).toBe(0);

    expect((await claim()).body).toMatchObject({ sent: true });
  });

  it("keeps the wallet blocked when the send may have gone through", async () => {
    sendUsdcFromAdmin.mockRejectedValueOnce(new Error("timeout"));

    const res = await claim();

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ sent: false, reason: "in_review" });
    expect((await grant()).status).toBe("reserved");
    expect((await claim()).body).toEqual({ sent: false, reason: "already_claimed" });
    expect(sendUsdcFromAdmin).toHaveBeenCalledOnce();
  });

  it("does not pay twice when recording the hash fails after sending", async () => {
    sendUsdcFromAdmin.mockImplementationOnce(async () => {
      supabaseDown = true;
      return "hash_sent";
    });

    expect((await claim()).body).toMatchObject({ sent: true, hash: "hash_sent" });

    supabaseDown = false;
    expect((await claim()).body).toEqual({ sent: false, reason: "already_claimed" });
    expect(sendUsdcFromAdmin).toHaveBeenCalledOnce();
  });

  it("spends nothing on a wallet without a trustline", async () => {
    usdcBalance.mockResolvedValue(null);

    expect((await claim()).body).toEqual({ sent: false, reason: "no_trustline" });
    expect(await grant()).toBeUndefined();
    expect(await spent()).toBe(0);
    expect(sendUsdcFromAdmin).not.toHaveBeenCalled();
  }, 10_000);
});

describe("clientIp", () => {
  it("takes the first address Vercel forwards", () => {
    expect(clientIp({ headers: { "x-vercel-forwarded-for": "3.3.3.3, 4.4.4.4", "x-real-ip": "5.5.5.5" } })).toBe("3.3.3.3");
    expect(clientIp({ headers: { "x-real-ip": "5.5.5.5" } })).toBe("5.5.5.5");
    expect(clientIp({ headers: { "x-forwarded-for": "6.6.6.6, 7.7.7.7" } })).toBe("6.6.6.6");
  });

  it("puts callers without an IP under one shared limit", () => {
    expect(clientIp({ headers: {} })).toBe("unknown");
    expect(clientIp(undefined)).toBe("unknown");
  });
});
