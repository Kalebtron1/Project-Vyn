import { Networks } from "@stellar/stellar-sdk";

export type StellarNetworkName = "testnet" | "mainnet";

export interface StellarNetworkConfig {
  network: StellarNetworkName;
  rpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
  usdcIssuer: string;
}

export const NETWORK_PRESETS: Record<StellarNetworkName, StellarNetworkConfig> = {
  testnet: {
    network: "testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    networkPassphrase: Networks.TESTNET,
    usdcIssuer: "GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
  },
  mainnet: {
    network: "mainnet",
    rpcUrl: "https://mainnet.sorobanrpc.com",
    horizonUrl: "https://horizon.stellar.org",
    networkPassphrase: Networks.PUBLIC,
    usdcIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  },
};

export function resolveStellarNetwork(
  env: Record<string, string | undefined> = import.meta.env
): StellarNetworkConfig {
  const rawNetwork = String(
    env?.VITE_STELLAR_NETWORK || env?.STELLAR_NETWORK || "testnet"
  )
    .trim()
    .toLowerCase();

  const normalized = (
    rawNetwork === "public" ? "mainnet" : rawNetwork
  ) as StellarNetworkName;

  const preset = NETWORK_PRESETS[normalized];
  if (!preset) {
    throw new Error(
      `Red Stellar no soportada: "${rawNetwork}". Usa "testnet" o "mainnet".`
    );
  }

  return {
    network: preset.network,
    rpcUrl:
      (env?.VITE_SOROBAN_RPC_URL || env?.SOROBAN_RPC_URL || "").trim() ||
      preset.rpcUrl,
    horizonUrl:
      (env?.VITE_HORIZON_URL || env?.HORIZON_URL || "").trim() ||
      preset.horizonUrl,
    networkPassphrase:
      (
        env?.VITE_STELLAR_NETWORK_PASSPHRASE ||
        env?.STELLAR_NETWORK_PASSPHRASE ||
        ""
      ).trim() || preset.networkPassphrase,
    usdcIssuer:
      (env?.VITE_USDC_ISSUER || env?.USDC_ISSUER || "").trim() ||
      preset.usdcIssuer,
  };
}

export const STELLAR_NETWORK = resolveStellarNetwork();
