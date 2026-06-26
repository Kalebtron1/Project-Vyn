/**
 * Mobile Wallet Connector Abstraction
 *
 * Strategy:
 * - Desktop: Freighter browser extension (existing flow, unchanged)
 * - Mobile:  Multiple options:
 *   - Albedo web wallet (works in any mobile browser via popup/redirect)
 *   - WalletConnect (mobile-friendly wallet aggregator via QR code or deep links)
 *
 * Albedo is a standards-based Stellar web wallet that requires no app install.
 * WalletConnect provides an additional mobile-friendly path for users with
 * WalletConnect-compatible Stellar wallets.
 */

import albedo from "@albedo-link/intent";
import UniversalProvider from "@walletconnect/universal-provider";
import * as FreighterAPI from "@stellar/freighter-api";
import { Networks, TransactionBuilder } from "@stellar/stellar-sdk";

// ─── Environment detection ────────────────────────────────────────────────────

export function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(
    navigator.userAgent
  );
}

export async function isFreighterAvailable(): Promise<boolean> {
  try {
    const result = await FreighterAPI.isConnected();
    return typeof result === "object" ? result.isConnected : Boolean(result);
  } catch {
    return false;
  }
}

// ─── Unified result types ─────────────────────────────────────────────────────

export type ConnectResult =
  | { ok: true; address: string; provider: "freighter" | "albedo" | "walletconnect" }
  | { ok: false; cancelled: boolean; error: string };

export type SignResult =
  | { ok: true; signedXdr: string }
  | { ok: false; cancelled: boolean; error: string };

// ─── Connect (get public key) ─────────────────────────────────────────────────

export async function connectWallet(): Promise<ConnectResult> {
  if (!isMobileBrowser() && await isFreighterAvailable()) {
    return connectFreighter();
  }
  return connectAlbedo();
}

/**
 * Connect to a specific provider.
 * Allows the UI to explicitly choose between multiple mobile options (Albedo, WalletConnect).
 */
export async function connectWithProvider(
  provider: "freighter" | "albedo" | "walletconnect"
): Promise<ConnectResult> {
  if (provider === "freighter") {
    return connectFreighter();
  }
  if (provider === "walletconnect") {
    return connectWalletConnect();
  }
  return connectAlbedo();
}

async function connectFreighter(): Promise<ConnectResult> {
  try {
    const res = await FreighterAPI.requestAccess();
    if (res.error) {
      const cancelled =
        res.error.includes("User declined") ||
        res.error.includes("User rejected") ||
        res.error.includes("rejected");
      return { ok: false, cancelled, error: res.error };
    }
    if (!res.address) {
      return { ok: false, cancelled: false, error: "No se obtuvo la dirección pública." };
    }
    return { ok: true, address: res.address, provider: "freighter" };
  } catch (err: any) {
    return { ok: false, cancelled: false, error: err?.message ?? "Error desconocido con Freighter." };
  }
}

async function connectAlbedo(): Promise<ConnectResult> {
  try {
    // albedo.publicKey() opens a popup/redirect and resolves with the user's
    // public key once they approve. On mobile it uses a redirect flow.
    const res = await albedo.publicKey({ require_existing: false });
    if (!res.pubkey) {
      return { ok: false, cancelled: false, error: "Albedo no devolvió una dirección." };
    }
    return { ok: true, address: res.pubkey, provider: "albedo" };
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    // Albedo throws "Operation rejected" when the user closes the popup
    const cancelled =
      msg.toLowerCase().includes("rejected") ||
      msg.toLowerCase().includes("cancel") ||
      msg.toLowerCase().includes("closed");
    return {
      ok: false,
      cancelled,
      error: cancelled
        ? "Conexión cancelada. Puedes intentarlo de nuevo."
        : `Error al conectar con Albedo: ${msg}`,
    };
  }
}

async function connectWalletConnect(): Promise<ConnectResult> {
  try {
    const provider = await UniversalProvider.init({
      projectId: "c4def77ac8a2450a9ec57ceb434ce2b0", // Public projectId for Stellar
      metadata: {
        name: "Vinculo",
        description: "Vinculo - Stellar Web App",
        url: window.location.origin,
        icons: [`${window.location.origin}/public/robots.txt`],
      },
    });

    // Subscribe to session updates
    provider.on("connect", () => {
      console.log("WalletConnect connected");
    });

    provider.on("disconnect", () => {
      console.log("WalletConnect disconnected");
    });

    // Connect to a wallet
    const session = await provider.connect({
      namespaces: {
        stellar: {
          methods: ["stellar_signMessage", "stellar_signAndSubmitXDR", "stellar_requestSigningXDR"],
          chains: ["stellar:mainnet"],
          events: ["stellar_event"],
          rpcMap: {
            mainnet: "https://horizon-testnet.stellar.org/",
          },
        },
      },
    });

    // Get the first namespace's first account address
    const accounts = session.namespaces.stellar?.accounts || [];
    if (!accounts.length) {
      return { ok: false, cancelled: false, error: "WalletConnect no devolvió una dirección." };
    }

    // Extract public key from account (format: stellar:mainnet:GBXXXX)
    const address = accounts[0].split(":")[2];
    if (!address) {
      return { ok: false, cancelled: false, error: "No se pudo extraer la dirección de WalletConnect." };
    }

    // Store the session for later signing
    sessionStorage.setItem("wc_session", JSON.stringify(session));

    return { ok: true, address, provider: "walletconnect" };
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    const cancelled =
      msg.toLowerCase().includes("rejected") ||
      msg.toLowerCase().includes("cancel") ||
      msg.toLowerCase().includes("closed") ||
      msg.toLowerCase().includes("user rejected");
    return {
      ok: false,
      cancelled,
      error: cancelled
        ? "Conexión cancelada. Puedes intentarlo de nuevo."
        : `Error al conectar con WalletConnect: ${msg}`,
    };
  }
}

// ─── Sign transaction XDR ─────────────────────────────────────────────────────

export async function signTransactionXdr(
  xdr: string,
  provider: "freighter" | "albedo" | "walletconnect"
): Promise<SignResult> {
  if (provider === "freighter") {
    return signWithFreighter(xdr);
  }
  if (provider === "walletconnect") {
    return signWithWalletConnect(xdr);
  }
  return signWithAlbedo(xdr);
}

async function signWithFreighter(xdr: string): Promise<SignResult> {
  try {
    const res = await FreighterAPI.signTransaction(xdr, {
      networkPassphrase: Networks.TESTNET,
    });
    if (res.error) {
      const cancelled =
        res.error.includes("User declined") ||
        res.error.includes("User rejected") ||
        res.error.includes("rejected");
      return { ok: false, cancelled, error: res.error };
    }
    if (!res.signedTxXdr) {
      return { ok: false, cancelled: false, error: "Freighter no devolvió la transacción firmada." };
    }
    return { ok: true, signedXdr: res.signedTxXdr };
  } catch (err: any) {
    return { ok: false, cancelled: false, error: err?.message ?? "Error al firmar con Freighter." };
  }
}

async function signWithAlbedo(xdr: string): Promise<SignResult> {
  try {
    const res = await albedo.tx({
      xdr,
      network: "testnet",
      submit: false, // we submit ourselves for consistency
    });
    if (!res.signed_envelope_xdr) {
      return { ok: false, cancelled: false, error: "Albedo no devolvió la transacción firmada." };
    }
    return { ok: true, signedXdr: res.signed_envelope_xdr };
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    const cancelled =
      msg.toLowerCase().includes("rejected") ||
      msg.toLowerCase().includes("cancel") ||
      msg.toLowerCase().includes("closed");
    return {
      ok: false,
      cancelled,
      error: cancelled
        ? "Firma cancelada. Puedes intentarlo de nuevo."
        : `Error al firmar con Albedo: ${msg}`,
    };
  }
}

async function signWithWalletConnect(xdr: string): Promise<SignResult> {
  try {
    const sessionJson = sessionStorage.getItem("wc_session");
    if (!sessionJson) {
      return { ok: false, cancelled: false, error: "Sesión de WalletConnect no encontrada. Reconecta tu wallet." };
    }

    const provider = await UniversalProvider.init({
      projectId: "c4def77ac8a2450a9ec57ceb434ce2b0",
      metadata: {
        name: "Vinculo",
        description: "Vinculo - Stellar Web App",
        url: window.location.origin,
        icons: [`${window.location.origin}/public/robots.txt`],
      },
    });

    // Restore the session
    await provider.connect({ session: JSON.parse(sessionJson) });

    // Get the account for the signing request
    const accounts = provider.session?.namespaces.stellar?.accounts || [];
    if (!accounts.length) {
      return { ok: false, cancelled: false, error: "No se encontró cuenta en WalletConnect." };
    }

    const account = accounts[0]; // format: stellar:mainnet:GBXXXX

    // Request signature using the Stellar RPC method
    // The wallet will present a signing popup/confirmation
    const result = await provider.request({
      topic: provider.session!.topic,
      chainId: "stellar:mainnet",
      request: {
        method: "stellar_signAndSubmitXDR",
        params: {
          xdr: xdr,
          submit: false, // we submit ourselves for consistency
        },
      },
    }) as any;

    if (!result || !result.signedXdr) {
      return { ok: false, cancelled: false, error: "WalletConnect no devolvió la transacción firmada." };
    }

    return { ok: true, signedXdr: result.signedXdr };
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    const cancelled =
      msg.toLowerCase().includes("rejected") ||
      msg.toLowerCase().includes("cancel") ||
      msg.toLowerCase().includes("closed") ||
      msg.toLowerCase().includes("user rejected");
    return {
      ok: false,
      cancelled,
      error: cancelled
        ? "Firma cancelada. Puedes intentarlo de nuevo."
        : `Error al firmar con WalletConnect: ${msg}`,
    };
  }
}

// ─── Persist / retrieve provider choice ──────────────────────────────────────

const PROVIDER_KEY = "vinculo_wallet_provider";

export function saveProvider(provider: "freighter" | "albedo" | "walletconnect"): void {
  localStorage.setItem(PROVIDER_KEY, provider);
}

export function getSavedProvider(): "freighter" | "albedo" | "walletconnect" {
  const saved = localStorage.getItem(PROVIDER_KEY);
  if (saved === "freighter" || saved === "albedo" || saved === "walletconnect") return saved;
  // Default: if on mobile default to albedo, else freighter
  return isMobileBrowser() ? "albedo" : "freighter";
}
