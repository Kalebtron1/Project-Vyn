import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import handler from "../../api/faucet-usdc.js";
import * as usdcMod from "../../api/_usdc.mjs";
import { resetFaucetMemoryForTests } from "../../api/_supabase.mjs";

function createMockRes() {
  return {
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
}

const WALLETS = [
  "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  "GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
  "GCZJM35NKGVK47BB4SPBDV25477PZYIYPVVG453LPYFNXLS3FGHDXOCM",
];

describe("POST /api/faucet-usdc rate limiting & fail-closed dedup", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetFaucetMemoryForTests();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_KEY;
    process.env.FAUCET_IP_DAILY_LIMIT = "2";
    process.env.FAUCET_GLOBAL_DAILY_LIMIT = "5";

    vi.spyOn(usdcMod, "usdcBalance").mockResolvedValue(0);
    vi.spyOn(usdcMod, "sendUsdcFromAdmin").mockResolvedValue("txhash123");
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("allows first-time claim and rejects duplicate claim for same wallet", async () => {
    const req1 = {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.10" },
      body: { address: WALLETS[0] },
    };
    const res1 = createMockRes();
    await handler(req1, res1);

    expect(res1.statusCode).toBe(200);
    expect(res1.body.sent).toBe(true);
    expect(res1.body.hash).toBe("txhash123");

    const res2 = createMockRes();
    await handler(req1, res2);
    expect(res2.statusCode).toBe(200);
    expect(res2.body.sent).toBe(false);
    expect(res2.body.reason).toBe("already_claimed");
  });

  it("rejects with 429 when per-IP daily limit is exceeded", async () => {
    const ip = "198.51.100.42";

    const res1 = createMockRes();
    await handler({ method: "POST", headers: { "x-forwarded-for": ip }, body: { address: WALLETS[0] } }, res1);
    expect(res1.statusCode).toBe(200);
    expect(res1.body.sent).toBe(true);

    const res2 = createMockRes();
    await handler({ method: "POST", headers: { "x-forwarded-for": ip }, body: { address: WALLETS[1] } }, res2);
    expect(res2.statusCode).toBe(200);
    expect(res2.body.sent).toBe(true);

    const res3 = createMockRes();
    await handler({ method: "POST", headers: { "x-forwarded-for": ip }, body: { address: WALLETS[2] } }, res3);
    expect(res3.statusCode).toBe(429);
    expect(res3.body.sent).toBe(false);
    expect(res3.body.reason).toBe("rate_limited");
    expect(res3.body.limitScope).toBe("ip");
  });

  it("fails closed with 503 when Supabase dedup store is unreachable", async () => {
    process.env.SUPABASE_URL = "https://unreachable.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Supabase connection refused"));

    const res = createMockRes();
    await handler(
      { method: "POST", headers: { "x-forwarded-for": "203.0.113.99" }, body: { address: WALLETS[3] } },
      res
    );

    expect(res.statusCode).toBe(503);
    expect(res.body.sent).toBe(false);
    expect(res.body.reason).toBe("dedup_unavailable");
    expect(usdcMod.sendUsdcFromAdmin).not.toHaveBeenCalled();
  });
});
