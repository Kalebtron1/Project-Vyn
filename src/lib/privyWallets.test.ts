import { describe, expect, it, vi } from "vitest";
import {
  createStellarWalletOnce,
  primaryStellarWallet,
  signingWalletFor,
  stellarWalletsOf,
} from "./privyWallets";

const user = (linkedAccounts: unknown[]) => ({ linkedAccounts });

describe("stellarWalletsOf / primaryStellarWallet", () => {
  it("orders Stellar wallets from oldest to newest, whatever order Privy returns", () => {
    const u = user([
      { type: "email", address: "a@b.c" },
      { type: "wallet", chainType: "stellar", address: "GNEW", firstVerifiedAt: "2026-06-28T11:22:05Z" },
      { type: "wallet", chainType: "ethereum", address: "0xabc", firstVerifiedAt: "2026-01-01T00:00:00Z" },
      { type: "wallet", chainType: "stellar", address: "GOLD", firstVerifiedAt: new Date("2026-06-28T11:22:01Z") },
    ]);
    expect(stellarWalletsOf(u)).toEqual(["GOLD", "GNEW"]);
    expect(primaryStellarWallet(u)).toBe("GOLD");
  });

  it("falls back to walletIndex, then address, when dates are missing", () => {
    const u = user([
      { type: "wallet", chainType: "stellar", address: "GB", walletIndex: 1 },
      { type: "wallet", chainType: "stellar", address: "GA", walletIndex: 1 },
      { type: "wallet", chainType: "stellar", address: "GZ", walletIndex: 0 },
    ]);
    expect(stellarWalletsOf(u)).toEqual(["GZ", "GA", "GB"]);
  });

  it("returns nothing for a user without a Stellar wallet", () => {
    expect(primaryStellarWallet(user([{ type: "email" }]))).toBeUndefined();
    expect(primaryStellarWallet(null)).toBeUndefined();
  });
});

describe("signingWalletFor", () => {
  it("signs with the transaction's source when it belongs to the account", () => {
    expect(signingWalletFor(["GOLD", "GNEW"], "GNEW")).toBe("GNEW");
  });

  it("falls back to the primary wallet otherwise", () => {
    expect(signingWalletFor(["GOLD", "GNEW"], "GSOMEONEELSE")).toBe("GOLD");
    expect(signingWalletFor(["GOLD"], undefined)).toBe("GOLD");
  });
});

describe("createStellarWalletOnce", () => {
  it("creates a single wallet when called twice at the same time", async () => {
    let resolve: (value: { wallet: { address: string } }) => void = () => {};
    const create = vi.fn(() => new Promise<{ wallet: { address: string } }>((r) => { resolve = r; }));

    const first = createStellarWalletOnce(create);
    const second = createStellarWalletOnce(create);
    resolve({ wallet: { address: "GONLY" } });

    await expect(first).resolves.toBe("GONLY");
    await expect(second).resolves.toBe("GONLY");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("allows a new attempt after the previous one failed", async () => {
    const failing = vi.fn(async () => { throw new Error("boom"); });
    await expect(createStellarWalletOnce(failing)).rejects.toThrow("boom");

    const working = vi.fn(async () => ({ wallet: { address: "GRETRY" } }));
    await expect(createStellarWalletOnce(working)).resolves.toBe("GRETRY");
  });
});
