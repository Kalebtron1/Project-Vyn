import { Networks } from "@stellar/stellar-sdk";

export const NETWORK_PRESETS = {
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

/**
 * Resuelve la configuración de red Stellar/Soroban para backend/serverless.
 * Acepta `STELLAR_NETWORK` o `VITE_STELLAR_NETWORK` ("testnet" | "mainnet" | "public").
 */
export function resolveStellarNetwork(env = process.env) {
  const rawNetwork = String(
    env?.STELLAR_NETWORK || env?.VITE_STELLAR_NETWORK || "testnet"
  )
    .trim()
    .toLowerCase();

  const normalized = rawNetwork === "public" ? "mainnet" : rawNetwork;
  const preset = NETWORK_PRESETS[normalized];
  if (!preset) {
    throw new Error(
      `Red Stellar no soportada: "${rawNetwork}". Usa "testnet" o "mainnet".`
    );
  }

  return {
    network: preset.network,
    rpcUrl:
      (env?.SOROBAN_RPC_URL || env?.VITE_SOROBAN_RPC_URL || "").trim() ||
      preset.rpcUrl,
    horizonUrl:
      (env?.HORIZON_URL || env?.VITE_HORIZON_URL || "").trim() ||
      preset.horizonUrl,
    networkPassphrase:
      (
        env?.STELLAR_NETWORK_PASSPHRASE ||
        env?.VITE_STELLAR_NETWORK_PASSPHRASE ||
        ""
      ).trim() || preset.networkPassphrase,
    usdcIssuer:
      (env?.USDC_ISSUER || env?.VITE_USDC_ISSUER || "").trim() ||
      preset.usdcIssuer,
  };
}
