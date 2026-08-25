import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";

const { mockAddress, mockAddress2 } = vi.hoisted(() => ({
  mockAddress: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  mockAddress2: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
}));

// Mock @privy-io/react-auth
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({
    authenticated: false,
    logout: vi.fn(),
  }),
}));

// Mock @stellar/freighter-api
vi.mock("@stellar/freighter-api", () => ({
  isConnected: vi.fn().mockResolvedValue({ isConnected: true }),
  requestAccess: vi.fn().mockResolvedValue({ address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" }),
  getAddress: vi.fn().mockResolvedValue({ address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" }),
  signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: "signed-xdr" }),
}));

// Mock @creit.tech/stellar-wallets-kit
vi.mock("@creit.tech/stellar-wallets-kit", () => ({
  StellarWalletsKit: {
    init: vi.fn(),
    authModal: vi.fn().mockResolvedValue({ address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" }),
    setWallet: vi.fn(),
    signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: "signed-xdr" }),
    selectedModule: { productId: "freighter" },
  },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
}));

import {
  isValidStellarAddress,
  isUserCancellation,
  parseWalletError,
  getFriendlyWalletMessage,
} from "@/lib/walletErrors";
import * as sessionStore from "@/lib/sessionStore";
import { WalletSessionProvider } from "@/context/WalletSessionContext";
import { useWallet } from "@/hooks/useWallet";

const VALID_STELLAR_ADDRESS = mockAddress;
const VALID_STELLAR_ADDRESS_2 = mockAddress2;

describe("Wallet Errors & Address Validation", () => {
  describe("isValidStellarAddress", () => {
    it("returns true for a valid Stellar public key", () => {
      expect(isValidStellarAddress(VALID_STELLAR_ADDRESS)).toBe(true);
      expect(isValidStellarAddress(VALID_STELLAR_ADDRESS_2)).toBe(true);
    });

    it("returns false for null, undefined, empty or whitespace", () => {
      expect(isValidStellarAddress(null)).toBe(false);
      expect(isValidStellarAddress(undefined)).toBe(false);
      expect(isValidStellarAddress("")).toBe(false);
      expect(isValidStellarAddress("   ")).toBe(false);
    });

    it("returns false for non-string types", () => {
      expect(isValidStellarAddress(12345)).toBe(false);
      expect(isValidStellarAddress({})).toBe(false);
      expect(isValidStellarAddress([])).toBe(false);
    });

    it("returns false for invalid prefix or length", () => {
      expect(isValidStellarAddress("SBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5")).toBe(false);
      expect(isValidStellarAddress("GBBD47IF6LWK7P7MDEVSCWR")).toBe(false);
      expect(isValidStellarAddress("not-a-valid-address")).toBe(false);
      expect(isValidStellarAddress("[object Object]")).toBe(false);
    });
  });

  describe("isUserCancellation", () => {
    it("detects boolean cancellation flags", () => {
      expect(isUserCancellation({ cancelled: true })).toBe(true);
      expect(isUserCancellation({ isCanceled: true })).toBe(true);
      expect(isUserCancellation({ code: "ACTION_REJECTED" })).toBe(true);
    });

    it("detects rejection / dismissal keywords in messages", () => {
      expect(isUserCancellation(new Error("User rejected the request"))).toBe(true);
      expect(isUserCancellation("Firma rechazada por el usuario")).toBe(true);
      expect(isUserCancellation("Conexión cancelada")).toBe(true);
      expect(isUserCancellation("Popup closed by user")).toBe(true);
      expect(isUserCancellation("User declined access")).toBe(true);
      expect(isUserCancellation("Acceso denegado")).toBe(true);
    });

    it("returns false for non-cancellation errors", () => {
      expect(isUserCancellation(new Error("Network connection timeout"))).toBe(false);
      expect(isUserCancellation("Resource not found")).toBe(false);
      expect(isUserCancellation(null)).toBe(false);
    });
  });

  describe("parseWalletError", () => {
    it("parses user cancellation", () => {
      const parsed = parseWalletError(new Error("User cancelled transaction"));
      expect(parsed.code).toBe("CANCELLED");
      expect(parsed.isCancelled).toBe(true);
    });

    it("parses popup blocked error", () => {
      const parsed = parseWalletError("Popup was blocked by browser");
      expect(parsed.code).toBe("POPUP_BLOCKED");
      expect(parsed.isCancelled).toBe(false);
    });

    it("parses locked wallet error", () => {
      const parsed = parseWalletError("Wallet is locked. Please unlock it.");
      expect(parsed.code).toBe("WALLET_LOCKED");
    });

    it("parses missing wallet error", () => {
      const parsed = parseWalletError("Freighter extension is not installed");
      expect(parsed.code).toBe("WALLET_MISSING");
    });

    it("parses expired session error", () => {
      const parsed = parseWalletError("Session expired, please log in again");
      expect(parsed.code).toBe("SESSION_EXPIRED");
    });

    it("parses account mismatch error", () => {
      const parsed = parseWalletError("Cuenta incorrecta. Usa tu cuenta registrada.");
      expect(parsed.code).toBe("ACCOUNT_MISMATCH");
    });

    it("parses account not found on-chain error", () => {
      const parsed = parseWalletError("Account not found (404 / resource missing)");
      expect(parsed.code).toBe("ACCOUNT_NOT_FOUND");
    });

    it("parses insufficient USDC error (Soroban #10)", () => {
      const parsed = parseWalletError("Error(Contract, #10): balance is not within allowed range");
      expect(parsed.code).toBe("INSUFFICIENT_USDC");
    });

    it("parses generic insufficient balance error", () => {
      const parsed = parseWalletError("Insufficient balance to cover fee");
      expect(parsed.code).toBe("INSUFFICIENT_BALANCE");
    });

    it("parses lending liquidity error", () => {
      const parsed = parseWalletError("request_loan failed: balance hosterror");
      expect(parsed.code).toBe("NO_LIQUIDITY");
    });

    it("parses active loan error", () => {
      const parsed = parseWalletError("User has an active loan");
      expect(parsed.code).toBe("ACTIVE_LOAN");
    });

    it("parses tier insufficient error", () => {
      const parsed = parseWalletError("NFT tier insufficient");
      expect(parsed.code).toBe("TIER_INSUFFICIENT");
    });

    it("parses network connection error", () => {
      const parsed = parseWalletError("Failed to fetch Horizon RPC: network timeout");
      expect(parsed.code).toBe("NETWORK_ERROR");
    });

    it("parses contract revert error", () => {
      const parsed = parseWalletError("HostError: unreachablecodereached");
      expect(parsed.code).toBe("CONTRACT_ERROR");
    });

    it("falls back to generic for unknown errors", () => {
      const parsed = parseWalletError("Something unusual happened");
      expect(parsed.code).toBe("GENERIC");
    });
  });

  describe("getFriendlyWalletMessage", () => {
    it("returns friendly default message in Spanish without t translator", () => {
      const msg = getFriendlyWalletMessage(new Error("User rejected"));
      expect(msg).toBe("Operación cancelada. Puedes intentarlo de nuevo cuando quieras.");

      const lockedMsg = getFriendlyWalletMessage("wallet is locked");
      expect(lockedMsg).toBe("Tu wallet está bloqueada. Desbloquéala en la extensión e intenta de nuevo.");
    });

    it("resolves through custom t translator when available", () => {
      const mockT = vi.fn((key: string, params?: Record<string, unknown>) => {
        if (key === "wallet_errors.cancelled") return "Translated: Cancelled";
        if (key === "wallet_errors.account_mismatch") return `Translated: Switch to ${params?.expected}`;
        return key;
      });

      const msg = getFriendlyWalletMessage(new Error("User cancelled"), mockT);
      expect(msg).toBe("Translated: Cancelled");
      expect(mockT).toHaveBeenCalledWith("wallet_errors.cancelled", undefined);

      const mismatchMsg = getFriendlyWalletMessage(
        "Cuenta incorrecta",
        mockT,
        { expected: "GDAH...J5W" }
      );
      expect(mismatchMsg).toBe("Translated: Switch to GDAH...J5W");
    });
  });
});

describe("sessionStore - Session Recovery & Expiration", () => {
  beforeEach(() => {
    localStorage.clear();
    // Clear cookies
    if (typeof document !== "undefined") {
      document.cookie.split(";").forEach((c) => {
        document.cookie = c
          .replace(/^ +/, "")
          .replace(/=.*/, `=;expires=${new Date().toUTCString()};path=/`);
      });
    }
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns empty session when no storage exists", () => {
    const session = sessionStore.restoreSession();
    expect(session.address).toBeNull();
    expect(session.provider).toBeNull();
    expect(session.onboarded).toBe(false);
    expect(session.isExpired).toBe(false);
    expect(session.isCorrupted).toBe(false);
  });

  it("saves and restores a healthy session", () => {
    sessionStore.saveSession(VALID_STELLAR_ADDRESS, "freighter", true);

    const session = sessionStore.restoreSession();
    expect(session.address).toBe(VALID_STELLAR_ADDRESS);
    expect(session.provider).toBe("freighter");
    expect(session.onboarded).toBe(true);
    expect(session.isExpired).toBe(false);
    expect(session.isCorrupted).toBe(false);
  });

  it("rehydrates localStorage from cookie when localStorage is cleared", () => {
    sessionStore.saveSession(VALID_STELLAR_ADDRESS, "albedo", true);

    // Simulate localStorage wipe while cookie persists
    localStorage.clear();
    expect(localStorage.getItem(sessionStore.WALLET_KEY)).toBeNull();

    const session = sessionStore.restoreSession();
    expect(session.address).toBe(VALID_STELLAR_ADDRESS);
    expect(session.provider).toBe("albedo");

    // LocalStorage should have been rehydrated
    expect(localStorage.getItem(sessionStore.WALLET_KEY)).toBe(VALID_STELLAR_ADDRESS);
  });

  it("gracefully purges corrupted / invalid address from storage", () => {
    // Put corrupted data in storage
    localStorage.setItem(sessionStore.WALLET_KEY, "invalid-garbage-address");
    localStorage.setItem(sessionStore.PROVIDER_KEY, "freighter");

    const session = sessionStore.restoreSession();
    expect(session.address).toBeNull();
    expect(session.isCorrupted).toBe(true);
    expect(session.isExpired).toBe(false);

    // Ensure corrupted data was cleared from storage
    expect(localStorage.getItem(sessionStore.WALLET_KEY)).toBeNull();
    expect(localStorage.getItem(sessionStore.PROVIDER_KEY)).toBeNull();
  });

  it("gracefully purges expired session exceeding TTL (30 days)", () => {
    const expiredTimestamp = Date.now() - (35 * 24 * 60 * 60 * 1000); // 35 days ago
    localStorage.setItem(sessionStore.WALLET_KEY, VALID_STELLAR_ADDRESS);
    localStorage.setItem(sessionStore.PROVIDER_KEY, "freighter");
    localStorage.setItem(sessionStore.SESSION_TIMESTAMP_KEY, expiredTimestamp.toString());

    const session = sessionStore.restoreSession();
    expect(session.address).toBeNull();
    expect(session.isExpired).toBe(true);
    expect(session.isCorrupted).toBe(false);

    // Ensure expired data was purged from storage
    expect(localStorage.getItem(sessionStore.WALLET_KEY)).toBeNull();
    expect(localStorage.getItem(sessionStore.SESSION_TIMESTAMP_KEY)).toBeNull();
  });

  it("clearSession clears all session keys across localStorage and cookies", () => {
    sessionStore.saveSession(VALID_STELLAR_ADDRESS, "freighter", true);
    expect(sessionStore.getItem(sessionStore.WALLET_KEY)).toBe(VALID_STELLAR_ADDRESS);

    sessionStore.clearSession();
    expect(sessionStore.getItem(sessionStore.WALLET_KEY)).toBeNull();
    expect(sessionStore.getItem(sessionStore.PROVIDER_KEY)).toBeNull();
    expect(sessionStore.getItem(sessionStore.ONBOARDED_KEY)).toBeNull();
    expect(sessionStore.getItem(sessionStore.SESSION_TIMESTAMP_KEY)).toBeNull();
  });
});

describe("WalletSessionContext and useWallet integration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("initializes and restores session inside WalletSessionProvider", async () => {
    sessionStore.saveSession(VALID_STELLAR_ADDRESS, "freighter", true);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WalletSessionProvider>{children}</WalletSessionProvider>
    );

    let hookResult!: ReturnType<typeof renderHook<ReturnType<typeof useWallet>>>;
    await act(async () => {
      hookResult = renderHook(() => useWallet(), { wrapper });
    });

    expect(hookResult.result.current.loading).toBe(false);
    expect(hookResult.result.current.wallet).toBe(VALID_STELLAR_ADDRESS);
    expect(hookResult.result.current.walletStatus).toBe("connected");
    expect(hookResult.result.current.shortWallet).toBe("GBBD4...FLA5");
  });

  it("handles corrupted session gracefully on provider mount", async () => {
    localStorage.setItem(sessionStore.WALLET_KEY, "bad-corrupted-address");

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WalletSessionProvider>{children}</WalletSessionProvider>
    );

    let hookResult!: ReturnType<typeof renderHook<ReturnType<typeof useWallet>>>;
    await act(async () => {
      hookResult = renderHook(() => useWallet(), { wrapper });
    });

    expect(hookResult.result.current.wallet).toBeNull();
    expect(hookResult.result.current.walletStatus).toBe("missing");
    expect(hookResult.result.current.sessionError).toContain("Sesión inválida");
  });

  it("handles expired session gracefully on provider mount", async () => {
    const expiredTimestamp = Date.now() - (35 * 24 * 60 * 60 * 1000);
    localStorage.setItem(sessionStore.WALLET_KEY, VALID_STELLAR_ADDRESS);
    localStorage.setItem(sessionStore.SESSION_TIMESTAMP_KEY, expiredTimestamp.toString());

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WalletSessionProvider>{children}</WalletSessionProvider>
    );

    let hookResult!: ReturnType<typeof renderHook<ReturnType<typeof useWallet>>>;
    await act(async () => {
      hookResult = renderHook(() => useWallet(), { wrapper });
    });

    expect(hookResult.result.current.wallet).toBeNull();
    expect(hookResult.result.current.isExpired).toBe(true);
    expect(hookResult.result.current.sessionError).toContain("expirado");
  });

  it("updates session on setWalletAddress and purges on disconnect", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WalletSessionProvider>{children}</WalletSessionProvider>
    );

    let hookResult!: ReturnType<typeof renderHook<ReturnType<typeof useWallet>>>;
    await act(async () => {
      hookResult = renderHook(() => useWallet(), { wrapper });
    });

    expect(hookResult.result.current.wallet).toBeNull();

    await act(async () => {
      hookResult.result.current.setWalletAddress(VALID_STELLAR_ADDRESS);
    });

    expect(hookResult.result.current.wallet).toBe(VALID_STELLAR_ADDRESS);
    expect(hookResult.result.current.walletStatus).toBe("connected");
    expect(sessionStore.getItem(sessionStore.WALLET_KEY)).toBe(VALID_STELLAR_ADDRESS);

    await act(async () => {
      hookResult.result.current.disconnect();
    });

    expect(hookResult.result.current.wallet).toBeNull();
    expect(hookResult.result.current.walletStatus).toBe("missing");
    expect(sessionStore.getItem(sessionStore.WALLET_KEY)).toBeNull();
  });

  it("reconnects cleanly and updates session", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WalletSessionProvider>{children}</WalletSessionProvider>
    );

    let hookResult!: ReturnType<typeof renderHook<ReturnType<typeof useWallet>>>;
    await act(async () => {
      hookResult = renderHook(() => useWallet(), { wrapper });
    });

    expect(hookResult.result.current.wallet).toBeNull();

    await act(async () => {
      const res = await hookResult.result.current.reconnect();
      expect(res.ok).toBe(true);
    });

    expect(hookResult.result.current.wallet).toBe(VALID_STELLAR_ADDRESS);
    expect(hookResult.result.current.walletStatus).toBe("connected");
  });
});
