// @vitest-environment node
/**
 * Off-ramp de punta a punta: el handler real, con Horizon y BlindPay simulados y las llamadas
 * a Supabase resueltas contra las migraciones reales en un Postgres embebido.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../../api/blindpay.js";
import { issueSessionToken } from "../../api/_session.mjs";

const { quoteAndPayout, createQuote, getPayout } = vi.hoisted(() => ({
  quoteAndPayout: vi.fn(),
  createQuote: vi.fn(),
  getPayout: vi.fn(),
}));
vi.mock("../../api/_blindpay-core.mjs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/_blindpay-core.mjs")>()),
  quoteAndPayout,
  createQuote,
  getPayout,
}));

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const USDC_ISSUER = "GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56";
const WALLET = `G${"A".repeat(55)}`;
const OTHER_WALLET = `G${"B".repeat(55)}`;
const FUNDING = `G${"F".repeat(55)}`;
const HASH = "a".repeat(64);

let db: PGlite;
let horizonTxs: Record<string, { tx: Record<string, unknown>; ops: Record<string, unknown>[] }>;
let supabaseDown: boolean;

function fundingTx(overrides: Record<string, unknown> = {}, opOverrides: Record<string, unknown> = {}, hash = HASH) {
  horizonTxs[hash] = {
    tx: { hash, successful: true, created_at: new Date().toISOString(), ...overrides },
    ops: [
      {
        type: "payment",
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: USDC_ISSUER,
        from: WALLET,
        to: FUNDING,
        amount: "25.0000000",
        ...opOverrides,
      },
    ],
  };
}

const json = (body: unknown, status = 200) => new Response(body == null ? null : JSON.stringify(body), { status });

// Lo mínimo de PostgREST que usa _supabase.mjs para ramp_payouts.
async function supabaseResponse(path: string, options: RequestInit) {
  const [resource, query = ""] = path.split("?");
  const body = options.body ? JSON.parse(String(options.body)) : null;
  const filters = [...query.matchAll(/(\w+)=eq\.([^&]+)/g)].map(([, column, value]) => [column, decodeURIComponent(value)]);
  if (options.method === "POST") {
    const row = body[0];
    const columns = Object.keys(row);
    const { rows } = await db.query(
      `insert into public.${resource} (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")})
       on conflict do nothing returning *`,
      columns.map((column) => row[column])
    );
    return json(rows, 201);
  }
  if (options.method === "PATCH") {
    const columns = Object.keys(body);
    const sets = columns.map((column, i) => `${column} = $${i + 1}`);
    const wheres = filters.map(([column], i) => `${column} = $${columns.length + i + 1}`);
    await db.query(`update public.${resource} set ${sets.join(", ")} where ${wheres.join(" and ")}`, [
      ...columns.map((column) => body[column]),
      ...filters.map(([, value]) => value),
    ]);
    return json(null, 204);
  }
  throw new Error(`unexpected ${options.method} ${path}`);
}

async function fakeFetch(input: RequestInfo | URL, options: RequestInit = {}) {
  const url = String(input);
  if (url.startsWith("https://db.test/rest/v1/")) {
    if (supabaseDown) return new Response("", { status: 503 });
    return supabaseResponse(url.replace("https://db.test/rest/v1/", ""), options);
  }
  const match = url.match(/horizon-testnet\.stellar\.org\/transactions\/([0-9a-f]+)(\/operations)?/);
  if (!match) throw new Error(`unexpected fetch ${url}`);
  const found = horizonTxs[match[1]];
  if (!found) return json({ status: 404 }, 404);
  return json(match[2] ? { _embedded: { records: found.ops } } : found.tx);
}

// Sesión de la wallet que manda la petición, salvo que el test diga otra (null = sin sesión).
const sessionCookie = (address: string | null) => (address ? `vyn_session=${issueSessionToken(address).token}` : "");

async function call(
  action: string,
  { body, query = {}, sessionFor }: { body?: Record<string, unknown> & { walletAddress?: string }; query?: Record<string, string>; sessionFor?: string | null } = {}
) {
  const cookie = sessionCookie(sessionFor === undefined ? body?.walletAddress ?? null : sessionFor);
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
  await handler({ method: body ? "POST" : "GET", query: { action, ...query }, body, headers: { cookie } }, res);
  return res;
}

const payout = (overrides: Record<string, unknown> = {}) =>
  call("payout", { body: { amount: 25, walletAddress: WALLET, fundingTxHash: HASH, ...overrides } });

const rows = async () =>
  (await db.query<Record<string, unknown>>("select * from public.ramp_payouts order by created_at")).rows;

beforeEach(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (const file of readdirSync(MIGRATIONS).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  horizonTxs = {};
  supabaseDown = false;
  vi.stubEnv("SUPABASE_URL", "https://db.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.stubEnv("AUTH_JWT_SECRET", "x".repeat(40));
  vi.stubEnv("BLINDPAY_DEMO_BANK_ACCOUNT_ID", "ba_demo");
  vi.stubEnv("OFFRAMP_FUNDING_ADDRESS", FUNDING);
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  let n = 0;
  quoteAndPayout.mockReset().mockImplementation(async ({ amountCents }) => {
    n += 1;
    return {
      quote: { id: `qu_${n}`, sender_amount: amountCents, receiver_amount: amountCents * 18, flat_fee: 0, blindpay_quotation: 1800, commercial_quotation: 1850 },
      payout: { id: `po_${n}`, status: amountCents === 66600 ? "failed" : "processing" },
    };
  });
  createQuote.mockReset().mockResolvedValue({ id: "qu_q", sender_amount: 2500, receiver_amount: 45000, flat_fee: 0, blindpay_quotation: 1800, commercial_quotation: 1850 });
  getPayout.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("payout", () => {
  it("pays out after verifying the funding payment and records it", async () => {
    fundingTx();

    const res = await payout();

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ payoutId: "po_1", status: "processing" });
    expect(quoteAndPayout).toHaveBeenCalledWith({ amountCents: 2500, bankAccountId: "ba_demo" });
    expect(await rows()).toEqual([
      expect.objectContaining({
        wallet_address: WALLET,
        funding_tx_hash: HASH,
        status: "submitted",
        blindpay_quote_id: "qu_1",
        blindpay_payout_id: "po_1",
      }),
    ]);
    expect(Number((await rows())[0].amount_usd_cents)).toBe(2500);
  });

  it("answers 409 for a reused funding hash, including in parallel", async () => {
    fundingTx();

    const results = await Promise.all([payout(), payout()]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect((await payout()).body).toEqual({ reason: "funding_already_used" });
    expect(quoteAndPayout).toHaveBeenCalledOnce();
    expect(await rows()).toHaveLength(1);
  });

  it("answers 401 without a session and 403 with another wallet's session", async () => {
    fundingTx();
    const body = { amount: 25, walletAddress: WALLET, fundingTxHash: HASH };

    expect((await call("payout", { body, sessionFor: null })).statusCode).toBe(401);
    const impostor = await call("payout", { body, sessionFor: OTHER_WALLET });
    expect(impostor.statusCode).toBe(403);
    expect(impostor.body).toMatchObject({ reason: "address_mismatch" });
    expect(quoteAndPayout).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(0);
  });

  it("answers 403 for a payment from another account", async () => {
    fundingTx({}, { from: OTHER_WALLET });

    const res = await payout();

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ reason: "funding_wrong_sender" });
    expect(quoteAndPayout).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(0);
  });

  it("answers 400 for a payment below the amount", async () => {
    fundingTx({}, { amount: "24.9999999" });

    const res = await payout();

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ reason: "funding_insufficient" });
    expect(quoteAndPayout).not.toHaveBeenCalled();
  });

  it("accepts a payment above the amount and pays out only the amount asked", async () => {
    fundingTx({}, { amount: "30.0000000" });

    expect((await payout()).statusCode).toBe(200);
    expect(quoteAndPayout).toHaveBeenCalledWith({ amountCents: 2500, bankAccountId: "ba_demo" });
  });

  it.each([
    ["to another destination", {}, { to: OTHER_WALLET }],
    ["in another asset", {}, { asset_code: "USDB" }],
    ["from another issuer", {}, { asset_issuer: OTHER_WALLET }],
    ["that is not a payment", {}, { type: "path_payment_strict_receive" }],
  ])("answers 400 for a payment %s", async (_label, tx, op) => {
    fundingTx(tx, op);

    const res = await payout();

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ reason: "funding_invalid" });
    expect(quoteAndPayout).not.toHaveBeenCalled();
  });

  it("refuses a transaction with more than one operation", async () => {
    fundingTx();
    horizonTxs[HASH].ops.push({ ...horizonTxs[HASH].ops[0] });

    expect((await payout()).body).toEqual({ reason: "funding_invalid" });
  });

  it("refuses failed, old and unknown transactions", async () => {
    fundingTx({ successful: false });
    expect((await payout()).body).toEqual({ reason: "funding_failed" });

    fundingTx({ created_at: new Date(Date.now() - 16 * 60 * 1000).toISOString() });
    expect((await payout()).body).toEqual({ reason: "funding_expired" });

    const unknown = await payout({ fundingTxHash: "b".repeat(64) });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.body).toEqual({ reason: "funding_not_found" });
    expect(quoteAndPayout).not.toHaveBeenCalled();
  });

  it("leaves the row in failed when the payout fails, and does not retry it", async () => {
    fundingTx();
    quoteAndPayout.mockRejectedValueOnce(new Error("BlindPay respondió 500"));

    expect((await payout()).statusCode).toBe(502);
    expect(await rows()).toEqual([expect.objectContaining({ status: "failed", error: "BlindPay respondió 500" })]);

    expect((await payout()).statusCode).toBe(409);
    expect(quoteAndPayout).toHaveBeenCalledOnce();
  });

  it("answers 503 and pays out nothing when Supabase is down", async () => {
    fundingTx();
    supabaseDown = true;

    expect((await payout()).statusCode).toBe(503);
    expect(quoteAndPayout).not.toHaveBeenCalled();
  });

  it("answers 503 without a funding address", async () => {
    vi.stubEnv("OFFRAMP_FUNDING_ADDRESS", "");
    fundingTx();

    expect((await payout()).statusCode).toBe(503);
    expect((await call("quote", { body: { amount: 25 } })).statusCode).toBe(503);
    expect(quoteAndPayout).not.toHaveBeenCalled();
  });

  it("validates the body", async () => {
    expect((await payout({ fundingTxHash: "not-a-hash" })).statusCode).toBe(400);
    expect((await payout({ walletAddress: "GBAD" })).statusCode).toBe(400);
    expect((await call("payout", { body: { amount: 25 } })).statusCode).toBe(400);
  });
});

describe("quote", () => {
  it("returns where the user must send the USDC", async () => {
    const res = await call("quote", { body: { amount: 25 } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ quoteId: "qu_q", fundingAddress: FUNDING });
  });
});

describe("status", () => {
  it.each([
    [666, "failed"],
    [777, "refunded"],
  ])("records the %i sentinel's final status (%s) for a manual refund", async (amount, status) => {
    fundingTx({}, { amount: `${amount}.0000000` });
    const created = await payout({ amount });
    getPayout.mockResolvedValueOnce({ id: created.body!.payoutId, status });

    const res = await call("status", { query: { id: String(created.body!.payoutId) } });

    expect(res.body).toMatchObject({ status });
    expect(await rows()).toEqual([expect.objectContaining({ status })]);
  });

  it("leaves the row alone while BlindPay is still processing", async () => {
    fundingTx();
    await payout();
    getPayout.mockResolvedValueOnce({ id: "po_1", status: "processing" });

    await call("status", { query: { id: "po_1" } });

    expect(await rows()).toEqual([expect.objectContaining({ status: "submitted" })]);
  });
});
