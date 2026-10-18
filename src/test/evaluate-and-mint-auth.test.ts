import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import nonceHandler, {
  buildChallengeTxXdr,
  resetNoncesForTests,
  verifySignedChallenge,
} from "../../api/nonce.js";
import mintHandler from "../../api/evaluate-and-mint.js";

const USER_ADDRESS = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const OTHER_ADDRESS = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

function createMockRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, any>,
    body: null as any,
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
}

describe("POST /api/evaluate-and-mint signed wallet challenge", () => {
  beforeEach(() => {
    resetNoncesForTests();
    process.env.STAKING_CONTRACT_ID =
      "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects mint requests without a nonce or signature with 401", async () => {
    const res = createMockRes();
    await mintHandler(
      {
        method: "POST",
        headers: { host: "localhost:3000" },
        body: { userAddress: USER_ADDRESS, totalVolume: 500 },
      },
      res
    );

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("rejects mint requests with an invalid signature with 401", async () => {
    const nonceRes = createMockRes();
    nonceHandler({ method: "POST", body: { address: USER_ADDRESS } }, nonceRes);
    const { nonce } = nonceRes.body;

    // Unsigned challenge XDR (no signatures)
    const unsignedXdr = buildChallengeTxXdr(USER_ADDRESS, nonce);

    const res = createMockRes();
    await mintHandler(
      {
        method: "POST",
        headers: { host: "localhost:3000" },
        body: {
          userAddress: USER_ADDRESS,
          nonce,
          signature: unsignedXdr,
          totalVolume: 500,
        },
      },
      res
    );

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/Firma de wallet inválida/i);
  });

  it("accepts a valid signed challenge once and rejects nonce reuse with 401", async () => {
    const nonceRes = createMockRes();
    nonceHandler({ method: "POST", body: { address: USER_ADDRESS } }, nonceRes);
    const { nonce } = nonceRes.body;

    // Mock Keypair.fromPublicKey.verify so we can test Ed25519 verification in jsdom
    vi.spyOn(Keypair, "fromPublicKey").mockImplementation((pub: string) => {
      return {
        publicKey: () => pub,
        verify: (_data: Buffer, sig: Buffer) =>
          pub === USER_ADDRESS && sig.equals(Buffer.alloc(64, 7)),
      } as any;
    });

    const validSigBase64 = Buffer.alloc(64, 7).toString("base64");

    // Wrong address fails verification and does not consume the user's nonce
    const wrongAddrCheck = verifySignedChallenge({
      address: OTHER_ADDRESS,
      nonce,
      signature: validSigBase64,
    });
    expect(wrongAddrCheck.ok).toBe(false);

    // First valid verification consumes the nonce
    const firstCheck = verifySignedChallenge({
      address: USER_ADDRESS,
      nonce,
      signature: validSigBase64,
    });
    expect(firstCheck.ok).toBe(true);

    // Second attempt with the same nonce is rejected as expired/consumed
    const secondRes = createMockRes();
    await mintHandler(
      {
        method: "POST",
        headers: { host: "localhost:3000" },
        body: {
          userAddress: USER_ADDRESS,
          nonce,
          signature: validSigBase64,
          totalVolume: 500,
        },
      },
      secondRes
    );
    expect(secondRes.statusCode).toBe(401);
    expect(secondRes.body.error).toMatch(/Invalid or expired nonce/i);
  });
});
