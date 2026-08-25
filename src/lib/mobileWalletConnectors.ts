/**
 * Conectores de wallet — capa de abstracción sobre Stellar Wallets Kit.
 *
 * Delega en Stellar Wallets Kit (ver `stellarWalletsKit.ts`), que muestra un modal
 * donde el usuario escoge su wallet (Freighter, Albedo, xBull, Lobstr, Hana, Rabet…)
 * y unifica conexión y firma.
 *
 * Utiliza el módulo centralizado `walletErrors` para detección robusta de cancelaciones
 * y mensajes amigables y consistentes.
 */

import * as FreighterAPI from "@stellar/freighter-api";
import {
  getKit,
  openWalletModal,
  NETWORK_PASSPHRASE,
  FREIGHTER_ID,
} from "@/lib/stellarWalletsKit";
import * as sessionStore from "@/lib/sessionStore";
import { PRIVY_PROVIDER, privySign } from "@/lib/privyBridge";
import { isUserCancellation, getFriendlyWalletMessage } from "@/lib/walletErrors";

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

// ─── Connect (open modal + get public key) ────────────────────────────────────

export async function connectWallet(): Promise<ConnectResult> {
  try {
    const { address, walletId } = await openWalletModal();
    if (!address) {
      return { ok: false, cancelled: false, error: "No se obtuvo la dirección pública de la wallet." };
    }
    return { ok: true, address, provider: walletId };
  } catch (err: unknown) {
    const cancelled = isUserCancellation(err);
    const error = getFriendlyWalletMessage(err);
    return {
      ok: false,
      cancelled,
      error,
    };
  }
}

// ─── Sign transaction XDR ─────────────────────────────────────────────────────

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
    const address = sessionStore.getItem(sessionStore.WALLET_KEY) ?? undefined;
    const { signedTxXdr } = await kit.signTransaction(xdr, {
      networkPassphrase: NETWORK_PASSPHRASE,
      address,
    });
    if (!signedTxXdr) {
      return { ok: false, cancelled: false, error: "La wallet no devolvió la transacción firmada." };
    }
    return { ok: true, signedXdr: signedTxXdr };
  } catch (err: unknown) {
    const cancelled = isUserCancellation(err);
    const error = getFriendlyWalletMessage(err);
    return {
      ok: false,
      cancelled,
      error,
    };
  }
}

// ─── Persist / retrieve provider choice ──────────────────────────────────────

export function saveProvider(provider: WalletId): void {
  sessionStore.setItem(sessionStore.PROVIDER_KEY, provider);
}

export function getSavedProvider(): WalletId {
  return sessionStore.getItem(sessionStore.PROVIDER_KEY) ?? FREIGHTER_ID;
}
