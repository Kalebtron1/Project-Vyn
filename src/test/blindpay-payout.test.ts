import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { nativeToScVal, rpc } from "@stellar/stellar-sdk";
import handler from "../../api/blindpay.js";
import * as blindpayCore from "../../api/_blindpay-core.mjs";
import { resetPayoutTxMemoryForTests } from "../../api/_supabase.mjs";

const VALID_WALLET = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const VALID_TX_HASH = "a".repeat(64);

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

describe("POST /api/blindpay?action=payout on-chain withdrawal binding", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetPayoutTxMemoryForTests();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_KEY;
    process.env.BLINDPAY_DEMO_BANK_ACCOUNT_ID = "ba_demo_123";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("rejects payout requests missing walletAddress or withdrawalTxHash with 400", async () => {
    const res = createMockRes();
    await handler(
      {
        method: "POST",
        query: { action: "payout" },
        body: { amount: 25 },
      },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/walletAddress|withdrawalTxHash/);
  });

  it("rejects payout when on-chain withdrawal transaction failed or amount is insufficient", async () => {
    vi.spyOn(rpc.Server.prototype, "getTransaction").mockResolvedValue({
      status: "SUCCESS",
      returnValue: nativeToScVal(100_000_000n, { type: "i128" }), // 10 USDC < 25 USDC requested
    } as any);

    const res = createMockRes();
    await handler(
      {
        method: "POST",
        query: { action: "payout" },
        body: {
          amount: 25,
          walletAddress: VALID_WALLET,
          withdrawalTxHash: VALID_TX_HASH,
        },
      },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/menor al solicitado/i);
  });

  it("succeeds once for a valid withdrawal tx and rejects reusing the same tx hash with 409", async () => {
    vi.spyOn(rpc.Server.prototype, "getTransaction").mockResolvedValue({
      status: "SUCCESS",
      returnValue: nativeToScVal(250_000_000n, { type: "i128" }), // 25 USDC
    } as any);

    const payoutSpy = vi.spyOn(blindpayCore, "quoteAndPayout").mockResolvedValue({
      quote: {
        id: "qu_1",
        sender_amount: 2500,
        receiver_amount: 45000,
        flat_fee: 50,
        partner_fee_amount: 0,
        blindpay_quotation: 1800,
        commercial_quotation: 1810,
        expires_at: "2026-12-31T00:00:00Z",
      },
      payout: {
        id: "po_123",
        status: "processing",
      },
    } as any);

    const req = {
      method: "POST",
      query: { action: "payout" },
      body: {
        amount: 25,
        walletAddress: VALID_WALLET,
        withdrawalTxHash: VALID_TX_HASH,
      },
    };

    const res1 = createMockRes();
    await handler(req, res1);
    expect(res1.statusCode).toBe(200);
    expect(res1.body.payoutId).toBe("po_123");
    expect(payoutSpy).toHaveBeenCalledTimes(1);

    const res2 = createMockRes();
    await handler(req, res2);
    expect(res2.statusCode).toBe(409);
    expect(res2.body.error).toMatch(/ya fue utilizada/i);
    expect(payoutSpy).toHaveBeenCalledTimes(1);
  });
});
