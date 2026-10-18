import { describe, expect, it } from "vitest";
import { Networks } from "@stellar/stellar-sdk";
import { resolveStellarNetwork } from "../stellar/network";
import { resolveStellarNetwork as resolveBackendNetwork } from "../../api/_network.mjs";

describe("resolveStellarNetwork", () => {
  it("defaults to testnet when no network env is provided", () => {
    const frontendCfg = resolveStellarNetwork({});
    const backendCfg = resolveBackendNetwork({});

    expect(frontendCfg.network).toBe("testnet");
    expect(frontendCfg.rpcUrl).toBe("https://soroban-testnet.stellar.org");
    expect(frontendCfg.horizonUrl).toBe("https://horizon-testnet.stellar.org");
    expect(frontendCfg.networkPassphrase).toBe(Networks.TESTNET);
    expect(backendCfg).toEqual(frontendCfg);
  });

  it("resolves mainnet preset for 'mainnet' and 'public'", () => {
    const cfg = resolveStellarNetwork({ VITE_STELLAR_NETWORK: "mainnet" });
    const publicCfg = resolveBackendNetwork({ STELLAR_NETWORK: "PUBLIC" });

    expect(cfg.network).toBe("mainnet");
    expect(cfg.rpcUrl).toBe("https://mainnet.sorobanrpc.com");
    expect(cfg.horizonUrl).toBe("https://horizon.stellar.org");
    expect(cfg.networkPassphrase).toBe(Networks.PUBLIC);
    expect(publicCfg).toEqual(cfg);
  });

  it("allows overriding RPC URL, Horizon URL, passphrase, and USDC issuer", () => {
    const cfg = resolveStellarNetwork({
      VITE_STELLAR_NETWORK: "testnet",
      VITE_SOROBAN_RPC_URL: "https://custom-rpc.example.com",
      VITE_HORIZON_URL: "https://custom-horizon.example.com",
      VITE_STELLAR_NETWORK_PASSPHRASE: "Custom Passphrase",
      VITE_USDC_ISSUER: "GCUSTOMISSUER1234567890",
    });

    expect(cfg.rpcUrl).toBe("https://custom-rpc.example.com");
    expect(cfg.horizonUrl).toBe("https://custom-horizon.example.com");
    expect(cfg.networkPassphrase).toBe("Custom Passphrase");
    expect(cfg.usdcIssuer).toBe("GCUSTOMISSUER1234567890");
  });

  it("throws on unsupported network names", () => {
    expect(() =>
      resolveStellarNetwork({ VITE_STELLAR_NETWORK: "devnet" })
    ).toThrow(/no soportada/i);
    expect(() =>
      resolveBackendNetwork({ STELLAR_NETWORK: "futurenet" })
    ).toThrow(/no soportada/i);
  });
});
