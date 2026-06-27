/**
 * Mobile Wallet Connector Abstraction
 *
 * Strategy:
 * - Desktop: Freighter browser extension (existing flow, unchanged)
 * - Mobile:  Albedo web wallet (works in any mobile browser via popup/redirect,
 *            already in package.json as @albedo-link/intent)
 *
 * Albedo is a standards-based Stellar web wallet that requires no app install
 * and supports both signing and public-key retrieval via a popup or redirect.
 * It is the safest non-lock-in choice: if a better mobile connector emerges
 * (e.g. WalletConnect for Stellar), only this file needs updating.
 */

import albedo from "@albedo-link/intent";
import * as FreighterAPI from "@stellar/freighter-api";
import { Networks } from "@stellar/stellar-sdk";
import * as sessionStore from "@/lib/sessionStore";

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
  | { ok: true; address: string; provider: "freighter" | "albedo" }
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

// ─── Sign transaction XDR ─────────────────────────────────────────────────────

export async function signTransactionXdr(
  xdr: string,
  provider: "freighter" | "albedo"
): Promise<SignResult> {
  if (provider === "freighter") {
    return signWithFreighter(xdr);
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

// ─── Persist / retrieve provider choice ──────────────────────────────────────

const PROVIDER_KEY = "vinculo_wallet_provider";

export function saveProvider(provider: "freighter" | "albedo"): void {
  sessionStore.setItem(PROVIDER_KEY, provider);
}

export function getSavedProvider(): "freighter" | "albedo" {
  const saved = sessionStore.getItem(PROVIDER_KEY);
  if (saved === "freighter" || saved === "albedo") return saved;
  // Default: if on mobile default to albedo, else freighter
  return isMobileBrowser() ? "albedo" : "freighter";
}
