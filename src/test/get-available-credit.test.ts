import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Keypair, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import handler from "../../api/get-available-credit.js";

const createMockRes = () => {
  const res: any = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k: string, v: any) {
      this.headers[k] = v;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
  return res;
};

describe("POST /api/get-available-credit", () => {
  const validUser = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
  const adminPub = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SECRET_KEY_ADMIN = "SDUMMYSECRETKEY";
    process.env.NFT_CONTRACT_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
    vi.spyOn(Keypair, "fromSecret").mockReturnValue({
      publicKey: () => adminPub,
    } as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("returns 500 when SECRET_KEY_ADMIN or NFT_CONTRACT_ID is missing", async () => {
    delete process.env.SECRET_KEY_ADMIN;
    const req = { method: "POST", body: { userAddress: validUser } };
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it("returns 502 when Soroban RPC fails instead of masking as tier 0", async () => {
    vi.spyOn(rpc.Server.prototype, "getAccount").mockRejectedValue(
      new Error("RPC unreachable")
    );

    const req = { method: "POST", body: { userAddress: validUser } };
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.details).toContain("RPC unreachable");
  });

  it("returns 200 with currency USDC on valid simulation", async () => {
    vi.spyOn(rpc.Server.prototype, "getAccount").mockResolvedValue({
      accountId: () => adminPub,
      sequenceNumber: () => "100",
      incrementSequenceNumber: () => {},
    } as any);

    vi.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      result: {
        retval: nativeToScVal(2, { type: "u32" }),
      },
    } as any);

    const req = { method: "POST", body: { userAddress: validUser } };
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      tier: 2,
      tierName: "Oro",
      availableCredit: 600,
      currency: "USDC",
    });
  });
});
