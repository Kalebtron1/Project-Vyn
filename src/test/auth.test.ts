// @vitest-environment node
/**
 * Sesión de wallet: desafío tipo SEP-10 firmado por una llave real, cookie JWT y el mint
 * del SBT protegido. Los desafíos usados se guardan en las migraciones reales sobre PGlite.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { Keypair, Networks, type Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import authHandler from "../../api/auth.js";
import mintHandler from "../../api/evaluate-and-mint.js";
import { issueSessionToken, readSessionToken } from "../../api/_session.mjs";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const user = Keypair.random();
const other = Keypair.random();
const server = Keypair.random();

let db: PGlite;
let supabaseDown: boolean;

async function fakeFetch(input: RequestInfo | URL, options: RequestInit = {}) {
  if (supabaseDown) return new Response("", { status: 503 });
  const name = String(input).split("/rpc/")[1];
  const body = JSON.parse(String(options.body));
  const { rows } = await db.query<{ result: boolean }>(
    `select public.${name}(p_challenge_hash => $1, p_expires_at => $2) as result`,
    [body.p_challenge_hash, body.p_expires_at]
  );
  return new Response(JSON.stringify(rows[0].result), { status: 200 });
}

type Res = {
  statusCode: number;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
  status(code: number): Res;
  json(payload: Record<string, unknown>): Res;
  setHeader(name: string, value: string): void;
  end(): Res;
};

async function call(handler: (req: unknown, res: Res) => unknown, { action = "", method = "POST", body, cookie = "" }: { action?: string; method?: string; body?: unknown; cookie?: string }) {
  const res: Res = {
    statusCode: 0,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end() {
      return this;
    },
  };
  await handler({ method, query: { action }, body, headers: cookie ? { cookie } : {} }, res);
  return res;
}

async function challengeFor(address: string) {
  const res = await call(authHandler, { action: "challenge", body: { address } });
  expect(res.statusCode).toBe(200);
  return res.body!.transaction as string;
}

function signXdr(xdr: string, ...keys: Keypair[]) {
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  for (const key of keys) tx.sign(key);
  return tx.toXDR();
}

const verify = (transaction: string) => call(authHandler, { action: "verify", body: { transaction } });

const cookieFrom = (res: { headers: Record<string, string> }) => res.headers["set-cookie"].split(";")[0];

beforeEach(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (const file of readdirSync(MIGRATIONS).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  supabaseDown = false;
  vi.stubEnv("SUPABASE_URL", "https://db.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.stubEnv("AUTH_SIGNING_SECRET", server.secret());
  vi.stubEnv("AUTH_JWT_SECRET", "x".repeat(40));
  vi.stubEnv("AUTH_HOME_DOMAIN", "vyn.test");
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("challenge and verify", () => {
  it("issues a session cookie for a challenge the wallet signed", async () => {
    const res = await verify(signXdr(await challengeFor(user.publicKey()), user));

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ address: user.publicKey() });
    const setCookie = res.headers["set-cookie"];
    expect(setCookie).toMatch(/^vyn_session=[\w-]+\.[\w-]+\.[\w-]+; Path=\/api; HttpOnly; Secure; SameSite=Strict; Max-Age=3600$/);

    const session = await call(authHandler, { action: "session", method: "GET", cookie: cookieFrom(res) });
    expect(session.statusCode).toBe(200);
    expect(session.body).toMatchObject({ address: user.publicKey() });
  });

  it("builds a challenge that never runs on the network", async () => {
    const tx = TransactionBuilder.fromXDR(await challengeFor(user.publicKey()), Networks.TESTNET) as Transaction;

    expect(tx.source).toBe(server.publicKey());
    expect(tx.sequence).toBe("0");
    expect(tx.operations[0]).toMatchObject({ type: "manageData", source: user.publicKey(), name: "vyn.test auth" });
    expect(Number(tx.timeBounds!.maxTime) - Number(tx.timeBounds!.minTime)).toBe(300);
  });

  it("rejects a challenge that was already used", async () => {
    const signed = signXdr(await challengeFor(user.publicKey()), user);
    expect((await verify(signed)).statusCode).toBe(200);

    const replay = await verify(signed);
    expect(replay.statusCode).toBe(401);
    expect(replay.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects a used challenge even with an extra signature", async () => {
    const challenge = await challengeFor(user.publicKey());
    expect((await verify(signXdr(challenge, user))).statusCode).toBe(200);

    expect((await verify(signXdr(challenge, user, other))).statusCode).toBe(401);
  });

  it("rejects an expired challenge", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-03T10:00:00Z"));
    const signed = signXdr(await challengeFor(user.publicKey()), user);

    vi.setSystemTime(new Date("2026-11-03T10:05:01Z"));
    expect((await verify(signed)).statusCode).toBe(401);
  });

  it("rejects a challenge signed by another key", async () => {
    expect((await verify(signXdr(await challengeFor(user.publicKey()), other))).statusCode).toBe(401);
  });

  it("rejects a challenge the user did not sign", async () => {
    expect((await verify(await challengeFor(user.publicKey()))).statusCode).toBe(401);
  });

  it("rejects a challenge made by another server key", async () => {
    const challenge = await challengeFor(user.publicKey());
    vi.stubEnv("AUTH_SIGNING_SECRET", Keypair.random().secret());

    expect((await verify(signXdr(challenge, user))).statusCode).toBe(401);
  });

  it("rejects a challenge for another domain", async () => {
    const challenge = await challengeFor(user.publicKey());
    vi.stubEnv("AUTH_HOME_DOMAIN", "other.test");

    expect((await verify(signXdr(challenge, user))).statusCode).toBe(401);
  });

  it("rejects garbage and an invalid address", async () => {
    expect((await verify("not-xdr")).statusCode).toBe(401);
    expect((await call(authHandler, { action: "challenge", body: { address: "GBAD" } })).statusCode).toBe(400);
  });

  it("answers 503 without Supabase, without issuing a session", async () => {
    const signed = signXdr(await challengeFor(user.publicKey()), user);
    supabaseDown = true;

    const res = await verify(signed);
    expect(res.statusCode).toBe(503);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("answers 503 without its secrets", async () => {
    vi.stubEnv("AUTH_SIGNING_SECRET", "");
    expect((await call(authHandler, { action: "challenge", body: { address: user.publicKey() } })).statusCode).toBe(503);

    vi.stubEnv("AUTH_SIGNING_SECRET", server.secret());
    vi.stubEnv("AUTH_JWT_SECRET", "short");
    expect((await verify(signXdr(await challengeFor(user.publicKey()), user))).statusCode).toBe(503);
  });

  it("clears the cookie on logout", async () => {
    const res = await call(authHandler, { action: "logout" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["set-cookie"]).toMatch(/^vyn_session=; .*Max-Age=0$/);
  });
});

describe("session token", () => {
  it("rejects tampered, expired and foreign tokens", () => {
    const { token } = issueSessionToken(user.publicKey());
    expect(readSessionToken(token)).toMatchObject({ address: user.publicKey() });

    const [header, , signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: other.publicKey(), exp: 9_999_999_999 })).toString("base64url");
    expect(readSessionToken(`${header}.${forged}.${signature}`)).toBeNull();

    expect(readSessionToken(token, Date.now() + 61 * 60 * 1000)).toBeNull();

    vi.stubEnv("AUTH_JWT_SECRET", "y".repeat(40));
    expect(readSessionToken(token)).toBeNull();
    expect(readSessionToken("a.b")).toBeNull();
  });

  it("answers 401 without a session", async () => {
    const res = await call(authHandler, { action: "session", method: "GET" });
    expect(res.statusCode).toBe(401);
  });
});

describe("evaluate-and-mint", () => {
  const mint = (cookie = "", userAddress = user.publicKey()) =>
    call(mintHandler, { body: { userAddress }, cookie });

  it("answers 401 without a session, before doing anything else", async () => {
    const res = await mint();

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ reason: "no_session" });
  });

  it("answers 401 with a forged cookie", async () => {
    expect((await mint("vyn_session=a.b.c")).statusCode).toBe(401);
  });

  it("answers 403 when the session belongs to another wallet", async () => {
    const { token } = issueSessionToken(other.publicKey());

    const res = await mint(`theme=dark; vyn_session=${token}`);

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ reason: "address_mismatch" });
  });
});
