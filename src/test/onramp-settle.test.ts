import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { settlePayin } from "../../api/_blindpay-onramp.mjs";
import * as usdcMod from "../../api/_usdc.mjs";
import { resetSettlementMemoryForTests } from "../../api/_supabase.mjs";

const USER_WALLET = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

describe("settlePayin idempotency and simulate gating", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetSettlementMemoryForTests();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_KEY;
    process.env.BLINDPAY_API_KEY = "bp_test_key";
    process.env.BLINDPAY_INSTANCE_ID = "in_test_123";
    process.env.BLINDPAY_DEMO_RECEIVER_ID = "re_test_123";
    delete process.env.BLINDPAY_ALLOW_SIMULATE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("ensures two concurrent settlePayin calls for the same payin produce only one USDC transfer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          id: "pi_concurrent_1",
          status: "completed",
          address: USER_WALLET,
          receiver_amount: 2500,
        }),
    } as any);

    const sendSpy = vi.spyOn(usdcMod, "sendUsdcFromAdmin").mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return "stellar_tx_hash_1";
    });

    const [res1, res2] = await Promise.all([
      settlePayin({ payinId: "pi_concurrent_1" }),
      settlePayin({ payinId: "pi_concurrent_1" }),
    ]);

    expect(sendSpy).toHaveBeenCalledTimes(1);

    const settledResults = [res1, res2].filter((r) => r.settled);
    const rejectedResults = [res1, res2].filter((r) => !r.settled);

    expect(settledResults).toHaveLength(1);
    expect(settledResults[0].hash).toBe("stellar_tx_hash_1");
    expect(rejectedResults).toHaveLength(1);
    expect(rejectedResults[0].reason).toBe("settlement_in_progress");

    const res3 = await settlePayin({ payinId: "pi_concurrent_1" });
    expect(res3.settled).toBe(false);
    expect(res3.reason).toBe("already_settled");
    expect(res3.hash).toBe("stellar_tx_hash_1");
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("ignores simulate: true unless BLINDPAY_ALLOW_SIMULATE is explicitly set to 'true'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          id: "pi_unpaid_1",
          status: "processing",
          address: USER_WALLET,
          receiver_amount: 1500,
        }),
    } as any);

    const sendSpy = vi.spyOn(usdcMod, "sendUsdcFromAdmin").mockResolvedValue("sim_hash_1");

    // Without BLINDPAY_ALLOW_SIMULATE="true", simulate is ignored
    const blocked = await settlePayin({ payinId: "pi_unpaid_1", simulate: true });
    expect(blocked.settled).toBe(false);
    expect(blocked.reason).toBe("not_paid");
    expect(sendSpy).not.toHaveBeenCalled();

    // With BLINDPAY_ALLOW_SIMULATE="true", simulate is allowed
    process.env.BLINDPAY_ALLOW_SIMULATE = "true";
    const allowed = await settlePayin({ payinId: "pi_unpaid_1", simulate: true });
    expect(allowed.settled).toBe(true);
    expect(allowed.simulated).toBe(true);
    expect(allowed.hash).toBe("sim_hash_1");
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});
