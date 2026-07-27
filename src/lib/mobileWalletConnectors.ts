/**
 * Conectores de wallet — capa de abstracción sobre Stellar Wallets Kit.
 *
 * Antes esta capa elegía manualmente entre Freighter (escritorio) y Albedo
 * (móvil). Ahora delega en Stellar Wallets Kit (ver `stellarWalletsKit.ts`),
 * que muestra un modal donde el usuario escoge su wallet (Freighter, Albedo,
 * xBull, Lobstr, Hana, Rabet…) y unifica conexión y firma.
 *
 * La API pública (`connectWallet`, `signTransactionXdr`, `ConnectResult`,
 * `SignResult`, `getSavedProvider`, `saveProvider`) se mantiene estable para no
 * tocar los puntos de firma (DepositModal, CreditSection, Tesoreria, Retiros).
 *
 * Cambio de tipo: `provider` deja de ser `"freighter" | "albedo"` y pasa a ser
 * el id de wallet del kit (string), ya que ahora puede ser cualquiera.
 */

import * as FreighterAPI from "@stellar/freighter-api";
import {
  getKit,
  openWalletModal,
  NETWORK_PASSPHRASE,
  FREIGHTER_ID,
  LOBSTR_ID,
} from "@/lib/stellarWalletsKit";
import * as sessionStore from "@/lib/sessionStore";
import { PRIVY_PROVIDER, privySign } from "@/lib/privyBridge";

// Re-export wallet ID constants so consumers can reference them without
// importing from the lower-level stellarWalletsKit module directly.
export { FREIGHTER_ID, LOBSTR_ID };

/**
 * Provider-specific limitations:
 *
 * - freighter  Desktop browser extension. Supports silent address polling via
 *              FreighterAPI.getAddress(), which enables account-change detection.
 *
 * - lobstr     Desktop browser extension (Chrome/Brave). Connects and signs via
 *              the @lobstrco/signer-extension-api under the hood. No silent
 *              address-polling API is exposed, so account-change detection is
 *              not available. Works identically to Freighter for connect/sign.
 *              LOBSTR does NOT have a mobile deep-link mode; on mobile the kit
 *              will show the option but the extension won't be available.
 *
 * - albedo     Web-based popup signer. Works on any browser including mobile.
 *              No address-polling API.
 *
 * - privy      Email / Google / Apple login. Managed embedded wallet.
 *              Signing is handled by privyBridge, not the kit.
 */

/** Id de wallet de Stellar Wallets Kit (p. ej. "freighter", "albedo", "xbull"). */
export type WalletId = string;

// ─── Environment detection ────────────────────────────────────────────────────

export function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(
    navigator.userAgent
  );
}

/** Sólo relevante para Freighter (detección de cambio de cuenta en escritorio). */
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
  | { ok: true; address: string; provider: WalletId }
  | { ok: false; cancelled: boolean; error: string };

export type SignResult =
  | { ok: true; signedXdr: string }
  | { ok: false; cancelled: boolean; error: string };

function isCancellation(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("reject") ||
    lower.includes("declined") ||
    lower.includes("cancel") ||
    lower.includes("closed") ||
    lower.includes("dismiss")
  );
}

// ─── Connect (open modal + get public key) ────────────────────────────────────

export async function connectWallet(): Promise<ConnectResult> {
  try {
    const { address, walletId } = await openWalletModal();
    if (!address) {
      return { ok: false, cancelled: false, error: "No se obtuvo la dirección pública." };
    }
    return { ok: true, address, provider: walletId };
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    const cancelled = isCancellation(msg);
    return {
      ok: false,
      cancelled,
      error: cancelled
        ? "Conexión cancelada. Puedes intentarlo de nuevo."
        : `Error al conectar la wallet: ${msg}`,
    };
  }
}

// ─── Sign transaction XDR ─────────────────────────────────────────────────────

const WALLET_KEY = "vinculo_wallet";

export async function signTransactionXdr(
  xdr: string,
  provider: WalletId
): Promise<SignResult> {
  try {
    // Sesión Privy (login con correo): la firma la maneja el SDK vía el puente,
    // no el kit multi-wallet.
    if (provider === PRIVY_PROVIDER) {
      const signedXdr = await privySign(xdr);
      return { ok: true, signedXdr };
    }

    const kit = getKit();
    kit.setWallet(provider);
    const address = sessionStore.getItem(WALLET_KEY) ?? undefined;
    const { signedTxXdr } = await kit.signTransaction(xdr, {
      networkPassphrase: NETWORK_PASSPHRASE,
      address,
    });
    if (!signedTxXdr) {
      return { ok: false, cancelled: false, error: "La wallet no devolvió la transacción firmada." };
    }
    return { ok: true, signedXdr: signedTxXdr };
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    const cancelled = isCancellation(msg);
    return {
      ok: false,
      cancelled,
      error: cancelled
        ? "Firma cancelada. Puedes intentarlo de nuevo."
        : `Error al firmar la transacción: ${msg}`,
    };
  }
}

// ─── Persist / retrieve provider choice ──────────────────────────────────────

const PROVIDER_KEY = "vinculo_wallet_provider";

export function saveProvider(provider: WalletId): void {
  sessionStore.setItem(PROVIDER_KEY, provider);
}

export function getSavedProvider(): WalletId {
  return sessionStore.getItem(PROVIDER_KEY) ?? FREIGHTER_ID;
}
