// @vitest-environment node
/**
 * Registro de la wallet del usuario en BlindPay. Sin SUPABASE_URL, el mapping vive en
 * memoria, así que cada test usa su propia dirección.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureBlockchainWallet, isPayinPaid, settlePayin } from "../../api/_blindpay-onramp.mjs";
import { getOnrampUserByWallet } from "../../api/_supabase.mjs";

const { sendUsdcFromAdmin } = vi.hoisted(() => ({ sendUsdcFromAdmin: vi.fn() }));
vi.mock("../../api/_usdc.mjs", () => ({ sendUsdcFromAdmin }));

const fetchMock = vi.fn();

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("settlePayin", () => {
  beforeEach(() => {
    vi.stubEnv("BLINDPAY_API_KEY", "test-key");
    vi.stubEnv("BLINDPAY_INSTANCE_ID", "in_test");
    vi.stubEnv("BLINDPAY_DEMO_RECEIVER_ID", "re_test");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("SUPABASE_KEY", "");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    sendUsdcFromAdmin.mockReset().mockResolvedValue("tx_hash");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does not pay a payin that BlindPay has not confirmed, even if asked to simulate", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "pi_wait", status: "processing", address: "GUSER", receiver_amount: 1000 }));

    const options = { payinId: "pi_wait", simulate: true };
    await expect(settlePayin(options)).resolves.toMatchObject({ settled: false, reason: "not_paid" });
    expect(sendUsdcFromAdmin).not.toHaveBeenCalled();
  });

  it("pays a confirmed payin once", async () => {
    const paid = { id: "pi_paid", status: "completed", address: "GUSER", receiver_amount: 1026 };
    fetchMock.mockImplementation(async () => jsonResponse(paid));

    await expect(settlePayin({ payinId: "pi_paid" })).resolves.toMatchObject({ settled: true, amountUsd: 10.26 });
    await expect(settlePayin({ payinId: "pi_paid" })).resolves.toMatchObject({ settled: false, reason: "already_settled" });
    expect(sendUsdcFromAdmin).toHaveBeenCalledTimes(1);
    expect(sendUsdcFromAdmin).toHaveBeenCalledWith({ to: "GUSER", amount: "10.2600000" });
  });

  it("treats failed and refunded as unpaid, whatever the tracking steps say", () => {
    const tracking = { tracking_payment: { step: "completed" } };
    expect(isPayinPaid({ status: "failed", ...tracking })).toBe(false);
    expect(isPayinPaid({ status: "refunded", ...tracking })).toBe(false);
    expect(isPayinPaid({ status: "processing", ...tracking })).toBe(true);
    expect(isPayinPaid({ status: "completed" })).toBe(true);
    expect(isPayinPaid({ status: "processing" })).toBe(false);
    expect(isPayinPaid(null)).toBe(false);
  });
});

describe("ensureBlockchainWallet", () => {
  beforeEach(() => {
    vi.stubEnv("BLINDPAY_API_KEY", "test-key");
    vi.stubEnv("BLINDPAY_INSTANCE_ID", "in_test");
    vi.stubEnv("BLINDPAY_DEMO_RECEIVER_ID", "re_test");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("SUPABASE_KEY", "");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("registers the wallet on the customers path, without following redirects", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "bw_new" }));

    const result = await ensureBlockchainWallet({ walletAddress: "GNEW" });

    expect(result).toEqual({ receiverId: "re_test", blockchainWalletId: "bw_new", reused: false });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/instances\/in_test\/customers\/re_test\/blockchain-wallets$/);
    expect(options.method).toBe("POST");
    expect(options.redirect).toBe("error");
    expect(JSON.parse(options.body)).toMatchObject({
      network: "stellar_testnet",
      is_account_abstraction: true,
      address: "GNEW",
    });
  });

  it("does not save a row when BlindPay returns no id", async () => {
    // Lo que devolvía la ruta vieja: el 301 hacía un GET, que lista las wallets.
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    await expect(ensureBlockchainWallet({ walletAddress: "GNOID" })).rejects.toThrow(/id/);
    expect(await getOnrampUserByWallet("GNOID")).toBeNull();
  });

  it("reuses a registered wallet without calling BlindPay", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "bw_once" }));
    await ensureBlockchainWallet({ walletAddress: "GONCE" });
    fetchMock.mockClear();

    const result = await ensureBlockchainWallet({ walletAddress: "GONCE" });

    expect(result).toMatchObject({ blockchainWalletId: "bw_once", reused: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a BlindPay error instead of saving", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "invalid address" }, 400));

    await expect(ensureBlockchainWallet({ walletAddress: "GBAD" })).rejects.toThrow("invalid address");
    expect(await getOnrampUserByWallet("GBAD")).toBeNull();
  });
});
