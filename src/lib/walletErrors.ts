/**
 * Centralized wallet error parsing, classification, and friendly message resolution.
 *
 * Provides a single source of truth for high-frequency wallet error codes,
 * cancellation detection, address validation, and actionable error messages
 * across all wallet adapters and interaction points.
 */

import { StrKey } from "@stellar/stellar-sdk";

export type WalletErrorCode =
  | "CANCELLED"
  | "POPUP_BLOCKED"
  | "WALLET_LOCKED"
  | "WALLET_MISSING"
  | "NETWORK_ERROR"
  | "SESSION_EXPIRED"
  | "ACCOUNT_MISMATCH"
  | "ACCOUNT_NOT_FOUND"
  | "INSUFFICIENT_BALANCE"
  | "INSUFFICIENT_USDC"
  | "NO_LIQUIDITY"
  | "ACTIVE_LOAN"
  | "TIER_INSUFFICIENT"
  | "CONTRACT_ERROR"
  | "GENERIC";

export interface ParsedWalletError {
  code: WalletErrorCode;
  rawMessage: string;
  isCancelled: boolean;
}

/**
 * Validates whether a given string conforms to a valid Stellar public key (G...).
 */
export function isValidStellarAddress(address: unknown): address is string {
  if (typeof address !== "string") return false;
  const trimmed = address.trim();
  if (!/^G[A-Z2-7]{55}$/.test(trimmed)) return false;
  try {
    return StrKey.isValidEd25519PublicKey(trimmed);
  } catch {
    return /^G[A-Z2-7]{55}$/.test(trimmed);
  }
}

/**
 * Checks whether an error represents an intentional cancellation / abort by the user.
 */
export function isUserCancellation(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "object" && error !== null) {
    const obj = error as Record<string, unknown>;
    if (obj.cancelled === true) return true;
    if (obj.isCanceled === true) return true;
    if (obj.code === "ACTION_REJECTED") return true;
  }
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes("reject") ||
    msg.includes("declined") ||
    msg.includes("cancel") ||
    msg.includes("closed") ||
    msg.includes("dismiss") ||
    msg.includes("rechaz") ||
    msg.includes("cancelad") ||
    msg.includes("denegad") ||
    msg.includes("user abort") ||
    msg.includes("popup closed")
  );
}

/**
 * Parses any error into a structured code and metadata.
 */
export function parseWalletError(error: unknown): ParsedWalletError {
  if (!error) {
    return { code: "GENERIC", rawMessage: "", isCancelled: false };
  }

  const rawMessage = error instanceof Error ? error.message : String(error);
  const lower = rawMessage.toLowerCase();

  if (isUserCancellation(error)) {
    return { code: "CANCELLED", rawMessage, isCancelled: true };
  }

  if (
    lower.includes("popup") ||
    lower.includes("ventana emergente") ||
    lower.includes("pop-up") ||
    lower.includes("blocked")
  ) {
    return { code: "POPUP_BLOCKED", rawMessage, isCancelled: false };
  }

  if (
    lower.includes("locked") ||
    lower.includes("bloqueada") ||
    lower.includes("desbloquea")
  ) {
    return { code: "WALLET_LOCKED", rawMessage, isCancelled: false };
  }

  if (
    lower.includes("not installed") ||
    lower.includes("instala") ||
    lower.includes("wallet missing") ||
    lower.includes("wallet not found") ||
    lower.includes("no instalada") ||
    lower.includes("wallet no disponible") ||
    lower.includes("no encontrada") ||
    lower.includes("extension not found")
  ) {
    return { code: "WALLET_MISSING", rawMessage, isCancelled: false };
  }

  if (
    lower.includes("expired") ||
    lower.includes("expirada") ||
    lower.includes("invalid session") ||
    lower.includes("sesión inválida") ||
    lower.includes("session invalid")
  ) {
    return { code: "SESSION_EXPIRED", rawMessage, isCancelled: false };
  }

  if (
    lower.includes("mismatch") ||
    lower.includes("cuenta incorrecta") ||
    lower.includes("wrong account") ||
    lower.includes("different account")
  ) {
    return { code: "ACCOUNT_MISMATCH", rawMessage, isCancelled: false };
  }

  if (
    lower.includes("not found") ||
    lower.includes("404") ||
    lower.includes("resource missing") ||
    lower.includes("op_no_destination") ||
    lower.includes("no existe") ||
    lower.includes("account not funded")
  ) {
    return { code: "ACCOUNT_NOT_FOUND", rawMessage, isCancelled: false };
  }

  if (
    lower.includes("tier") ||
    lower.includes("sbt") ||
    lower.includes("nivel insuficiente")
  ) {
    return { code: "TIER_INSUFFICIENT", rawMessage, isCancelled: false };
  }

  if (
    lower.includes("no_liquidity") ||
    (lower.includes("request_loan") && lower.includes("balance"))
  ) {
    return { code: "NO_LIQUIDITY", rawMessage, isCancelled: false };
  }

  if (
    lower.includes("active loan") ||
    lower.includes("no active loan") ||
    lower.includes("préstamo activo")
  ) {
    return { code: "ACTIVE_LOAN", rawMessage, isCancelled: false };
  }

  if (
    lower.includes("#10") ||
    lower.includes("saldo usdc") ||
    lower.includes("balance is not within") ||
    lower.includes("not within the allowed range")
  ) {
    return { code: "INSUFFICIENT_USDC", rawMessage, isCancelled: false };
  }

  if (
    lower.includes("insufficient") ||
    lower.includes("saldo insuficiente") ||
    lower.includes("insufficient balance") ||
    lower.includes("underfunded")
  ) {
    return { code: "INSUFFICIENT_BALANCE", rawMessage, isCancelled: false };
  }

  if (
    lower.includes("network") ||
    lower.includes("fetch") ||
    lower.includes("timeout") ||
    lower.includes("econnrefused") ||
    lower.includes("sin conexión") ||
    lower.includes("failed to fetch")
  ) {
    return { code: "NETWORK_ERROR", rawMessage, isCancelled: false };
  }

  if (
    lower.includes("hosterror") ||
    lower.includes("unreachablecodereached") ||
    lower.includes("invalidaction") ||
    lower.includes("tx_failed") ||
    lower.includes("contract")
  ) {
    return { code: "CONTRACT_ERROR", rawMessage, isCancelled: false };
  }

  return { code: "GENERIC", rawMessage, isCancelled: false };
}

/**
 * Resolves a human-readable, actionable error message using i18n when available,
 * falling back to clear default messages.
 */
export function getFriendlyWalletMessage(
  error: unknown,
  t?: (key: string, options?: Record<string, unknown>) => string,
  params?: Record<string, unknown>
): string {
  const { code, rawMessage } = parseWalletError(error);

  if (t) {
    const key = `wallet_errors.${code.toLowerCase()}`;
    const translated = t(key, params);
    if (translated && translated !== key) {
      return translated;
    }

    // Secondary fallback to login.errors / credit.errors if present
    const loginKey = `login.errors.${code.toLowerCase()}`;
    const loginTranslated = t(loginKey, params);
    if (loginTranslated && loginTranslated !== loginKey) {
      return loginTranslated;
    }
  }

  switch (code) {
    case "CANCELLED":
      return "Operación cancelada. Puedes intentarlo de nuevo cuando quieras.";
    case "POPUP_BLOCKED":
      return "El popup fue bloqueado. Permite ventanas emergentes para este sitio e intenta de nuevo.";
    case "WALLET_LOCKED":
      return "Tu wallet está bloqueada. Desbloquéala en la extensión e intenta de nuevo.";
    case "WALLET_MISSING":
      return "Wallet no disponible o no instalada. Conecta tu wallet para continuar.";
    case "SESSION_EXPIRED":
      return "Tu sesión ha expirado o es inválida. Por favor reconecta tu wallet.";
    case "ACCOUNT_MISMATCH":
      return params?.expected
        ? `Cuenta incorrecta. Por favor cambia a la cuenta ${params.expected} en tu wallet.`
        : "Cuenta incorrecta. Usa la wallet con la que iniciaste sesión.";
    case "ACCOUNT_NOT_FOUND":
      return "La cuenta no existe en la red Stellar. Asegúrate de que esté fondeada con XLM.";
    case "INSUFFICIENT_USDC":
      return params?.balance !== undefined
        ? `Saldo USDC insuficiente. Tienes ${params.balance} USDC disponibles.`
        : "Saldo USDC insuficiente para esta operación.";
    case "INSUFFICIENT_BALANCE":
      return "Saldo insuficiente para cubrir la transacción y las comisiones de red.";
    case "NO_LIQUIDITY":
      return "No hay liquidez suficiente en el pool en este momento. Intenta más tarde o con un monto menor.";
    case "ACTIVE_LOAN":
      return "Ya tienes un préstamo activo. Debes pagarlo antes de solicitar uno nuevo.";
    case "TIER_INSUFFICIENT":
      return "Tu nivel actual no habilita este crédito. Sube de nivel e intenta de nuevo.";
    case "NETWORK_ERROR":
      return "Sin conexión a la red. Verifica tu internet e intenta de nuevo.";
    case "CONTRACT_ERROR":
      return "Error al ejecutar el contrato inteligente. Intenta de nuevo.";
    case "GENERIC":
    default:
      return rawMessage || "Error al procesar la operación con la wallet. Intenta de nuevo.";
  }
}
