/**
 * sessionStore — almacenamiento durable para la sesión de wallet.
 *
 * En móvil el `localStorage` puede comportarse de forma poco fiable (modos de
 * privacidad, navegadores in-app, límites de almacenamiento). Para que la sesión
 * sobreviva a recargas y a reabrir el navegador, espejamos cada valor también en
 * una cookie de larga duración y, al leer, caemos a la cookie si `localStorage`
 * está vacío (rehidratándolo). Todos los accesos van envueltos en try/catch para
 * no romper si el almacenamiento está bloqueado.
 *
 * Incluye validación de formato de dirección Stellar y control de expiración (TTL)
 * para sanear de forma transparente sesiones inválidas o corruptas.
 */

import { isValidStellarAddress } from "./walletErrors";

export const WALLET_KEY = "vinculo_wallet";
export const ONBOARDED_KEY = "vinculo_onboarded";
export const PROVIDER_KEY = "vinculo_wallet_provider";
export const SESSION_TIMESTAMP_KEY = "vinculo_session_timestamp";

/** Duración máxima de la sesión: 30 días */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;

function readCookie(key: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${encodeURIComponent(key)}=`;
  const found = document.cookie
    .split("; ")
    .find((c) => c.startsWith(prefix));
  if (!found) return null;
  return decodeURIComponent(found.slice(prefix.length));
}

function writeCookie(key: string, value: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(
    value
  )}; max-age=${SESSION_MAX_AGE_SECONDS}; path=/; SameSite=Lax`;
}

function deleteCookie(key: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${encodeURIComponent(key)}=; max-age=0; path=/; SameSite=Lax`;
}

export function getItem(key: string): string | null {
  try {
    const ls = localStorage.getItem(key);
    if (ls !== null) return ls;
  } catch {
    /* localStorage bloqueado: seguimos con la cookie */
  }
  const cookie = readCookie(key);
  if (cookie !== null) {
    // Rehidratar localStorage para que el resto de la sesión sea consistente.
    try {
      localStorage.setItem(key, cookie);
    } catch {
      /* ignore */
    }
    return cookie;
  }
  return null;
}

export function setItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
  writeCookie(key, value);
}

export function removeItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  deleteCookie(key);
}

/**
 * Guarda una sesión activa completa de forma consistente en localStorage y cookies.
 */
export function saveSession(address: string, provider: string, onboarded: boolean = true): void {
  const timestamp = Date.now().toString();
  setItem(WALLET_KEY, address);
  setItem(PROVIDER_KEY, provider);
  if (onboarded) {
    setItem(ONBOARDED_KEY, "1");
  }
  setItem(SESSION_TIMESTAMP_KEY, timestamp);
}

/**
 * Limpia todas las claves de sesión durable en localStorage y cookies.
 */
export function clearSession(): void {
  removeItem(WALLET_KEY);
  removeItem(PROVIDER_KEY);
  removeItem(ONBOARDED_KEY);
  removeItem(SESSION_TIMESTAMP_KEY);
}

export interface RestoredSession {
  address: string | null;
  provider: string | null;
  onboarded: boolean;
  isExpired: boolean;
  isCorrupted: boolean;
}

/**
 * Restaura y valida la sesión de wallet almacenada.
 * Si la dirección es inválida (corrupta) o la sesión expiró (TTL excedido),
 * limpia automáticamente el almacenamiento residual y devuelve el motivo.
 */
export function restoreSession(): RestoredSession {
  const rawAddress = getItem(WALLET_KEY);
  const rawProvider = getItem(PROVIDER_KEY);
  const rawOnboarded = getItem(ONBOARDED_KEY) === "1";
  const rawTimestamp = getItem(SESSION_TIMESTAMP_KEY);

  // Si no hay ninguna dirección guardada, no hay sesión activa.
  if (!rawAddress) {
    return {
      address: null,
      provider: null,
      onboarded: false,
      isExpired: false,
      isCorrupted: false,
    };
  }

  // 1. Validar formato de la dirección Stellar
  const trimmedAddress = rawAddress.trim();
  if (!isValidStellarAddress(trimmedAddress)) {
    // Sesión corrupta / string inválido
    clearSession();
    return {
      address: null,
      provider: null,
      onboarded: false,
      isExpired: false,
      isCorrupted: true,
    };
  }

  // 2. Validar expiración por timestamp (si existe timestamp)
  if (rawTimestamp) {
    const savedTime = parseInt(rawTimestamp, 10);
    if (!isNaN(savedTime) && Date.now() - savedTime > SESSION_MAX_AGE_MS) {
      // Sesión expirada
      clearSession();
      return {
        address: null,
        provider: null,
        onboarded: false,
        isExpired: true,
        isCorrupted: false,
      };
    }
  }

  // Sesión válida y saludable
  return {
    address: trimmedAddress,
    provider: rawProvider && rawProvider.trim() ? rawProvider.trim() : null,
    onboarded: rawOnboarded,
    isExpired: false,
    isCorrupted: false,
  };
}
