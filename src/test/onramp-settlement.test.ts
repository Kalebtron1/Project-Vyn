// @vitest-environment node
/**
 * Liquidación del on-ramp de punta a punta: el handler real, con BlindPay simulado y las
 * llamadas a Supabase resueltas contra las migraciones reales en un Postgres embebido.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../../api/onramp.js";
import { issueSessionToken } from "../../api/_session.mjs";

const { sendUsdcFromAdmin } = vi.hoisted(() => ({ sendUsdcFromAdmin: vi.fn() }));
vi.mock("../../api/_usdc.mjs", () => ({ sendUsdcFromAdmin }));

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const WALLET = `G${"A".repeat(55)}`;
const OTHER_WALLET = `G${"B".repeat(55)}`;

let db: PGlite;
let blindpayPayins: Record<string, Record<string, unknown>>;
let blindpayCalls: string[];
let supabaseDown: boolean;

const json = (body: unknown, status = 200) =>
  new Response(body === null ? null : JSON.stringify(body), { status });

// Lo mínimo de PostgREST que usa _supabase.mjs.
async function supabaseResponse(path: string, options: RequestInit) {
  const [resource, query = ""] = path.split("?");
  const body = options.body ? JSON.parse(String(options.body)) : null;

  if (resource.startsWith("rpc/")) {
    const names = Object.keys(body);
    const args = names.map((name, i) => `${name} => $${i + 1}`).join(", ");
    const { rows } = await db.query<{ result: unknown }>(
      `select public.${resource.slice(4)}(${args}) as result`,
      names.map((name) => body[name])
    );
    return json(rows[0].result ?? null);
  }
  const match = query.match(/(\w+)=eq\.([^&]+)/);
  if (options.method === "PATCH") {
    await db.query(`update public.${resource} set status = $1 where ${match![1]} = $2`, [
      body.status,
      decodeURIComponent(match![2]),
    ]);
    return json(null, 204);
  }
  if (options.method === "POST") {
    for (const row of body) {
      const columns = Object.keys(row);
      const conflict = query.includes("on_conflict") ? "on conflict do nothing" : "";
      await db.query(
        `insert into public.${resource} (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")}) ${conflict}`,
        columns.map((column) => row[column])
      );
    }
    return json(null, 201);
  }
  const { rows } = await db.query(
    `select * from public.${resource} where ${match![1]} = $1 limit 1`,
    [decodeURIComponent(match![2])]
  );
  return json(rows);
}

async function fakeFetch(input: RequestInfo | URL, options: RequestInit = {}) {
  const url = String(input);
  if (url.startsWith("https://db.test/rest/v1/")) {
    if (supabaseDown) return new Response("", { status: 503 });
    return supabaseResponse(url.replace("https://db.test/rest/v1/", ""), options);
  }
  blindpayCalls.push(url);
  if (url.endsWith("/payin-quotes")) {
    const { request_amount } = JSON.parse(String(options.body));
    // Tipo de cambio fijo de 20 MXN por USD.
    return json({ id: "qu_1", sender_amount: request_amount, receiver_amount: Math.floor(request_amount / 20) });
  }
  if (url.endsWith("/payins/evm")) {
    return json({ id: `pi_${blindpayCalls.length}`, status: "processing", clabe: "646180000000000000" });
  }
  const payin = blindpayPayins[url.split("/").pop()!];
  return payin ? json(payin) : json({ message: "not found" }, 404);
}

// Sesión de la wallet que manda la petición, salvo que el test diga otra (null = sin sesión).
const sessionCookie = (address: string | null) => (address ? `vyn_session=${issueSessionToken(address).token}` : "");

async function call(action: string, body: Record<string, unknown> & { walletAddress?: string }, sessionFor: string | null = body?.walletAddress ?? null) {
  const res = {
    statusCode: 0,
    setHeader() {},
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
  await handler({ method: "POST", query: { action }, body, headers: { cookie: sessionCookie(sessionFor) } }, res);
  return res;
}

const settle = (payinId: string, walletAddress = WALLET, sessionFor: string | null = walletAddress) =>
  call("settle", { payinId, walletAddress }, sessionFor);

// Crea el payin por el camino real y BlindPay lo reporta como `status` (lo que haría el sandbox).
async function createPayin(amountMxn: number, status = "completed", wallet = WALLET) {
  const created = await call("payin", { walletAddress: wallet, amountMxn });
  expect(created.statusCode).toBe(200);
  const payinId = created.body!.payinId as string;
  blindpayPayins[payinId] = {
    id: payinId,
    status,
    address: wallet,
    receiver_amount: created.body!.receiverUsd ? Math.round((created.body!.receiverUsd as number) * 100) : Math.floor((amountMxn * 100) / 20),
  };
  return payinId;
}

const settlementRow = async (payinId: string) => {
  const { rows } = await db.query<{ status: string; tx_hash: string | null; error: string | null }>(
    "select status, tx_hash, error from public.ramp_settlements where payin_id = $1",
    [payinId]
  );
  return rows[0];
};

beforeEach(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (const file of readdirSync(MIGRATIONS).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  await db.query(
    "insert into public.ramp_customers (wallet_address, blindpay_receiver_id, blindpay_blockchain_wallet_id) values ($1, 're_1', 'bw_1'), ($2, 're_1', 'bw_2')",
    [WALLET, OTHER_WALLET]
  );
  blindpayPayins = {};
  blindpayCalls = [];
  supabaseDown = false;
  vi.stubEnv("BLINDPAY_API_KEY", "test-key");
  vi.stubEnv("BLINDPAY_INSTANCE_ID", "in_test");
  vi.stubEnv("BLINDPAY_DEMO_RECEIVER_ID", "re_test");
  vi.stubEnv("SUPABASE_URL", "https://db.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.stubEnv("AUTH_JWT_SECRET", "x".repeat(40));
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  let sent = 0;
  sendUsdcFromAdmin.mockReset().mockImplementation(async () => `hash_${++sent}`);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("settle", () => {
  it("pays once when two settles run in parallel", async () => {
    const payinId = await createPayin(500);

    const results = await Promise.all([settle(payinId), settle(payinId)]);

    expect(sendUsdcFromAdmin).toHaveBeenCalledOnce();
    expect(results.filter((r) => r.body!.settled === true)).toHaveLength(1);
    expect((await settlementRow(payinId)).status).toBe("sent");
  });

  it("pays the bound wallet the quoted amount and answers a repeat without paying", async () => {
    const payinId = await createPayin(500);

    const first = await settle(payinId);
    expect(first.body).toMatchObject({ settled: true, to: WALLET, amountUsd: 25 });
    expect(sendUsdcFromAdmin).toHaveBeenCalledWith({ to: WALLET, amount: "25.0000000" });

    const repeat = await settle(payinId);
    expect(repeat.statusCode).toBe(200);
    expect(repeat.body).toMatchObject({ settled: false, reason: "already_settled", hash: "hash_1" });
    expect(sendUsdcFromAdmin).toHaveBeenCalledOnce();
  });

  it("answers 403 for a payin of another wallet", async () => {
    const payinId = await createPayin(500);

    const res = await settle(payinId, OTHER_WALLET);

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ settled: false, reason: "forbidden" });
    expect(sendUsdcFromAdmin).not.toHaveBeenCalled();
  });

  it("answers 401 without a session and 403 with another wallet's session", async () => {
    const payinId = await createPayin(500);

    const anonymous = await settle(payinId, WALLET, null);
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.body).toMatchObject({ reason: "no_session" });

    const impostor = await settle(payinId, WALLET, OTHER_WALLET);
    expect(impostor.statusCode).toBe(403);
    expect(impostor.body).toMatchObject({ reason: "address_mismatch" });
    expect(sendUsdcFromAdmin).not.toHaveBeenCalled();
  });

  it("answers 404 for a payin that was not created here", async () => {
    blindpayPayins.pi_old = { id: "pi_old", status: "completed", address: WALLET, receiver_amount: 1000 };

    const res = await settle("pi_old");

    expect(res.statusCode).toBe(404);
    expect(sendUsdcFromAdmin).not.toHaveBeenCalled();
  });

  it.each([
    [666, "failed"],
    [777, "refunded"],
  ])("does not pay the %i sentinel, which BlindPay reports as %s", async (amountMxn, status) => {
    const payinId = await createPayin(amountMxn, status);
    blindpayPayins[payinId].tracking_payment = { step: "completed" };

    const res = await settle(payinId);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ settled: false, reason: "not_paid", status });
    expect(sendUsdcFromAdmin).not.toHaveBeenCalled();
    expect(await settlementRow(payinId)).toBeUndefined();
    const { rows } = await db.query<{ status: string }>("select status from public.ramp_payins where payin_id = $1", [payinId]);
    expect(rows[0].status).toBe(status);
  });

  it("refuses when BlindPay reports another address", async () => {
    const payinId = await createPayin(500);
    blindpayPayins[payinId].address = OTHER_WALLET;

    const res = await settle(payinId);

    expect(res.statusCode).toBe(409);
    expect(sendUsdcFromAdmin).not.toHaveBeenCalled();
  });

  it("never pays more than BlindPay confirms or than was quoted", async () => {
    const lower = await createPayin(500);
    blindpayPayins[lower].receiver_amount = 2000;
    expect((await settle(lower)).body).toMatchObject({ settled: true, amountUsd: 20 });

    const higher = await createPayin(500);
    blindpayPayins[higher].receiver_amount = 9000;
    expect((await settle(higher)).body).toMatchObject({ settled: true, amountUsd: 25 });
  });

  it("answers 429 at the wallet and global daily caps", async () => {
    vi.stubEnv("ONRAMP_WALLET_DAILY_USD_CENTS", "3000");
    vi.stubEnv("ONRAMP_GLOBAL_DAILY_USD_CENTS", "5000");
    const first = await createPayin(500);
    const second = await createPayin(500);
    expect((await settle(first)).statusCode).toBe(200);

    const walletCap = await settle(second);
    expect(walletCap.statusCode).toBe(429);
    expect(walletCap.body).toMatchObject({ reason: "wallet_cap" });

    const other = await createPayin(600, "completed", OTHER_WALLET);
    await db.query("update public.ramp_payins set wallet_address = $1 where payin_id = $2", [OTHER_WALLET, other]);
    const globalCap = await settle(other, OTHER_WALLET);
    expect(globalCap.statusCode).toBe(429);
    expect(globalCap.body).toMatchObject({ reason: "global_cap" });
    expect(sendUsdcFromAdmin).toHaveBeenCalledOnce();
  });

  it("frees the reservation only when the send declared that it failed", async () => {
    const payinId = await createPayin(500);
    sendUsdcFromAdmin.mockRejectedValueOnce(Object.assign(new Error("Horizon: tx_bad_seq"), { notSent: true }));

    expect((await settle(payinId)).statusCode).toBe(502);
    expect(await settlementRow(payinId)).toMatchObject({ status: "failed", error: "Horizon: tx_bad_seq" });

    expect((await settle(payinId)).body).toMatchObject({ settled: true });
    expect(await settlementRow(payinId)).toMatchObject({ status: "sent" });
  });

  it("keeps the reservation blocked when the send may have gone through", async () => {
    const payinId = await createPayin(500);
    sendUsdcFromAdmin.mockRejectedValueOnce(new Error("timeout"));

    const res = await settle(payinId);

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ reason: "in_review" });
    expect(await settlementRow(payinId)).toMatchObject({ status: "reserved" });

    const retry = await settle(payinId);
    expect(retry.body).toMatchObject({ reason: "in_review" });
    expect(sendUsdcFromAdmin).toHaveBeenCalledOnce();
  });

  it("does not pay twice when recording the hash fails after sending", async () => {
    const payinId = await createPayin(500);
    sendUsdcFromAdmin.mockImplementationOnce(async () => {
      supabaseDown = true;
      return "hash_sent";
    });

    expect((await settle(payinId)).body).toMatchObject({ settled: true, hash: "hash_sent" });

    supabaseDown = false;
    expect((await settle(payinId)).body).toMatchObject({ reason: "in_review" });
    expect(sendUsdcFromAdmin).toHaveBeenCalledOnce();
  });

  it("answers 503 and sends nothing when Supabase is down", async () => {
    const payinId = await createPayin(500);
    supabaseDown = true;

    expect((await settle(payinId)).statusCode).toBe(503);
    expect(sendUsdcFromAdmin).not.toHaveBeenCalled();
  });

  it("validates the body", async () => {
    expect((await call("settle", { payinId: "pi_1" })).statusCode).toBe(400);
    expect((await call("settle", { walletAddress: WALLET })).statusCode).toBe(400);
  });
});

describe("payin", () => {
  it("saves the payin with its wallet and amounts before returning the CLABE", async () => {
    const res = await call("payin", { walletAddress: WALLET, amountMxn: 500 });

    expect(res.body).toMatchObject({ clabe: "646180000000000000" });
    const { rows } = await db.query<Record<string, unknown>>("select * from public.ramp_payins");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ payin_id: res.body!.payinId, wallet_address: WALLET, status: "processing" });
    expect(Number(rows[0].sender_mxn_cents)).toBe(50000);
    expect(Number(rows[0].receiver_usd_cents)).toBe(2500);
  });

  it("gives no CLABE if the payin cannot be saved", async () => {
    const real = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, options) =>
      String(input).endsWith("/ramp_payins") ? new Response("", { status: 503 }) : real(input, options)
    );

    const res = await call("payin", { walletAddress: WALLET, amountMxn: 500 });

    expect(res.statusCode).toBe(503);
    expect(res.body).not.toHaveProperty("clabe");
  });

  it("needs the wallet's session to generate a CLABE, but not to quote", async () => {
    expect((await call("payin", { walletAddress: WALLET, amountMxn: 500 }, null)).statusCode).toBe(401);
    expect((await call("payin", { walletAddress: WALLET, amountMxn: 500 }, OTHER_WALLET)).statusCode).toBe(403);
    expect(blindpayCalls.some((url) => url.endsWith("/payins/evm"))).toBe(false);

    expect((await call("quote", { walletAddress: WALLET, amountMxn: 500 }, null)).statusCode).toBe(200);
  });

  it("rejects an amount over the cap before creating anything", async () => {
    const res = await call("payin", { walletAddress: WALLET, amountMxn: 2001 });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ reason: "payin_cap", maxUsd: 100 });
    expect(blindpayCalls.some((url) => url.endsWith("/payins/evm"))).toBe(false);
  });

  it("warns about the cap at the quote", async () => {
    const res = await call("quote", { walletAddress: WALLET, amountMxn: 2001 });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ reason: "payin_cap" });
  });
});

describe("init", () => {
  it("copies a wallet registered only in the old table without calling BlindPay", async () => {
    const wallet = `G${"C".repeat(55)}`;
    await db.query(
      "insert into public.onramp_users (wallet_address, email, blindpay_receiver_id, blindpay_blockchain_wallet_id) values ($1, 'a@b.c', 're_old', 'bw_old')",
      [wallet]
    );

    const res = await call("init", { walletAddress: wallet });

    expect(res.body).toEqual({ receiverId: "re_old", blockchainWalletId: "bw_old", reused: true });
    expect(blindpayCalls).toHaveLength(0);
    const { rows } = await db.query<{ blindpay_blockchain_wallet_id: string }>(
      "select blindpay_blockchain_wallet_id from public.ramp_customers where wallet_address = $1",
      [wallet]
    );
    expect(rows[0].blindpay_blockchain_wallet_id).toBe("bw_old");
  });
});
