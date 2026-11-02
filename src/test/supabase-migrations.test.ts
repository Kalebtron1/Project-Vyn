// @vitest-environment node
/**
 * Corre las migraciones reales en un Postgres embebido y prueba las funciones atómicas.
 * Los roles de Supabase se crean aquí porque el Postgres de prueba no los trae.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const WALLET = `G${"A".repeat(55)}`;
const OTHER_WALLET = `G${"B".repeat(55)}`;

let db: PGlite;

async function migrate(upTo = "9999") {
  for (const file of readdirSync(MIGRATIONS).sort()) {
    if (file <= upTo) await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
}

async function value<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<Record<string, T>>(sql, params);
  return Object.values(rows[0])[0];
}

const reserveSettlement = (payin: string, wallet = WALLET, cents = 1000, walletCap = 5000, globalCap = 10000) =>
  value<string>("select public.reserve_settlement($1, $2, $3, $4, $5)", [payin, wallet, cents, walletCap, globalCap]);

const reserveFaucet = (wallet = WALLET, ip = "ip1", cents = 200, ipMax = 2, globalCap = 1000) =>
  value<string>("select public.reserve_faucet($1, $2, $3, $4, $5)", [wallet, ip, cents, ipMax, globalCap]);

const spent = (budget: string) =>
  value<string>("select coalesce(sum(spent_cents), 0) from public.daily_budgets where budget = $1", [budget]).then(Number);

beforeEach(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
});

describe("settlement reservation", () => {
  beforeEach(() => migrate());

  it("lets only the first reservation of a payin through", async () => {
    expect(await reserveSettlement("pi_1")).toBe("reserved");
    expect(await reserveSettlement("pi_1")).toBe("already_reserved");
    expect(await spent("settlement")).toBe(1000);
  });

  it("keeps paid and unfinished reservations closed", async () => {
    await reserveSettlement("pi_1");
    await db.query("select public.finish_settlement($1, $2, null)", ["pi_1", "hash1"]);
    expect(await reserveSettlement("pi_1")).toBe("already_reserved");
    expect(await value("select status from public.ramp_settlements")).toBe("sent");
  });

  it("allows a retry after a declared failure and returns the budget", async () => {
    await reserveSettlement("pi_1");
    await db.query("select public.finish_settlement($1, null, $2)", ["pi_1", "horizon error"]);
    expect(await spent("settlement")).toBe(0);
    expect(await reserveSettlement("pi_1")).toBe("reserved");
    expect(await spent("settlement")).toBe(1000);
  });

  it("does not finish a reservation twice", async () => {
    await reserveSettlement("pi_1");
    await db.query("select public.finish_settlement($1, $2, null)", ["pi_1", "hash1"]);
    await db.query("select public.finish_settlement($1, null, $2)", ["pi_1", "late error"]);
    expect(await value("select tx_hash from public.ramp_settlements")).toBe("hash1");
    expect(await spent("settlement")).toBe(1000);
  });

  it("enforces the wallet and global daily caps", async () => {
    expect(await reserveSettlement("pi_1", WALLET, 4000)).toBe("reserved");
    expect(await reserveSettlement("pi_2", WALLET, 1001)).toBe("wallet_cap");
    expect(await reserveSettlement("pi_3", OTHER_WALLET, 4000, 5000, 7000)).toBe("global_cap");
    expect(await spent("settlement")).toBe(4000);
  });

  it("rejects zero and negative amounts", async () => {
    await expect(reserveSettlement("pi_1", WALLET, 0)).rejects.toThrow();
    await expect(reserveSettlement("pi_2", WALLET, -5)).rejects.toThrow();
    expect(await spent("settlement")).toBe(0);
  });
});

describe("faucet reservation", () => {
  beforeEach(() => migrate());

  it("allows one grant per wallet", async () => {
    expect(await reserveFaucet()).toBe("reserved");
    expect(await reserveFaucet()).toBe("already_claimed");
  });

  it("limits grants per IP and overall", async () => {
    expect(await reserveFaucet(WALLET, "ip1")).toBe("reserved");
    expect(await reserveFaucet(OTHER_WALLET, "ip1", 200, 1)).toBe("ip_cap");
    expect(await reserveFaucet(OTHER_WALLET, "ip2", 200, 2, 300)).toBe("global_cap");
  });

  it("frees the wallet and the budget when the send fails", async () => {
    await reserveFaucet();
    await db.query("select public.finish_faucet($1, null)", [WALLET]);
    expect(await spent("faucet")).toBe(0);
    expect(await reserveFaucet()).toBe("reserved");
  });

  it("keeps the wallet closed after a successful send", async () => {
    await reserveFaucet();
    await db.query("select public.finish_faucet($1, $2)", [WALLET, "hash1"]);
    expect(await reserveFaucet()).toBe("already_claimed");
  });
});

describe("rate limits and challenges", () => {
  beforeEach(() => migrate());

  it("lets requests through up to the limit", async () => {
    const hit = () => value<boolean>("select public.hit_rate_limit('ip', 3600, 2)");
    expect(await hit()).toBe(true);
    expect(await hit()).toBe(true);
    expect(await hit()).toBe(false);
  });

  it("accepts a challenge only once and clears expired ones", async () => {
    const use = (hash: string, expires: string) =>
      value<boolean>("select public.consume_auth_challenge($1, $2)", [hash, expires]);
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(await use("abc", future)).toBe(true);
    expect(await use("abc", future)).toBe(false);

    await use("old", new Date(Date.now() - 60_000).toISOString());
    await db.exec("select public.delete_expired_records()");
    expect(await value("select count(*)::int from public.used_auth_challenges")).toBe(1);
  });
});

describe("access", () => {
  beforeEach(() => migrate());

  const tables = [
    "onramp_users", "faucet_claims", "onramp_settlements", "ramp_customers", "ramp_payins", "ramp_settlements",
    "ramp_payouts", "faucet_grants", "daily_budgets", "webhook_events", "used_auth_challenges", "rate_limits",
  ];

  it("gives anon and authenticated nothing on any table", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const table of tables) {
        for (const privilege of ["select", "insert", "update", "delete"]) {
          expect(await value(`select has_table_privilege('${role}', 'public.${table}', '${privilege}')`)).toBe(false);
        }
      }
    }
  });

  it("gives every public function only to service_role", async () => {
    const { rows } = await db.query<{ oid: number; name: string; anon: boolean; authed: boolean; service: boolean }>(`
      select p.oid, p.proname as name,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as authed,
             has_function_privilege('service_role', p.oid, 'execute') as service
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'`);
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const row of rows) {
      expect(row, row.name).toMatchObject({ anon: false, authed: false, service: true });
    }
  });

  it("enables row level security with no policies", async () => {
    expect(await value(`select count(*)::int from pg_policies where schemaname = 'public'`)).toBe(0);
    for (const table of tables) {
      expect(await value(`select relrowsecurity from pg_class where oid = 'public.${table}'::regclass`)).toBe(true);
    }
  });

  it("closes tables created later", async () => {
    await db.exec("create table public.later (id int)");
    expect(await value("select has_table_privilege('anon', 'public.later', 'select')")).toBe(false);
  });
});

describe("backfill", () => {
  it("copies current data, leaves emails behind and can run twice", async () => {
    await migrate("0002_ramp_schema.sql");
    await db.query(
      "insert into public.onramp_users (wallet_address, email, blindpay_receiver_id, blindpay_blockchain_wallet_id) values ($1, 'a@b.c', 're_1', 'bw_1'), ($2, null, 're_1', null)",
      [WALLET, OTHER_WALLET]
    );
    await db.query(
      "insert into public.onramp_settlements (payin_id, wallet_address, amount_usd, hash) values ('pi_1', $1, 10.26, 'h1')",
      [WALLET]
    );
    await db.query("insert into public.faucet_claims (wallet_address) values ($1)", [WALLET]);

    const backfill = readFileSync(join(MIGRATIONS, "0003_backfill.sql"), "utf8");
    await db.exec(backfill);
    await db.exec(backfill);

    expect(await value("select count(*)::int from public.ramp_customers")).toBe(1);
    const columns = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'ramp_customers'"
    );
    expect(columns.rows.map((c) => c.column_name)).not.toContain("email");
    expect(await value("select amount_usd_cents::int from public.ramp_settlements")).toBe(1026);
    expect(await value("select status from public.ramp_settlements")).toBe("sent");

    // Lo ya pagado sigue cerrado en las funciones nuevas.
    expect(await reserveSettlement("pi_1")).toBe("already_reserved");
    expect(await reserveFaucet()).toBe("already_claimed");
  });
});

describe("baseline", () => {
  it("can run again over an existing project with open policies", async () => {
    await db.exec(`
      create table public.faucet_claims (wallet_address text primary key, claimed_at timestamptz not null default now());
      alter table public.faucet_claims enable row level security;
      create policy "faucet_claims backend access" on public.faucet_claims for all to anon, authenticated using (true);
      grant all on public.faucet_claims to anon;
    `);
    const baseline = readFileSync(join(MIGRATIONS, "0001_baseline_close_access.sql"), "utf8");
    await db.exec(baseline);
    await db.exec(baseline);

    expect(await value(`select count(*)::int from pg_policies where schemaname = 'public'`)).toBe(0);
    expect(await value("select has_table_privilege('anon', 'public.faucet_claims', 'select')")).toBe(false);
  });
});
