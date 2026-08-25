/**
 * WalletSessionContext — fuente única de verdad de la sesión de wallet.
 *
 * Carga la sesión UNA sola vez al arrancar (con respaldo en cookie + validación)
 * y la mantiene en memoria por encima del router. Así, navegar entre rutas
 * nunca vuelve a re-derivar la sesión desde `localStorage` ni dispara un login espurio.
 *
 * Incluye saneamiento de sesiones inválidas/expiradas, reconexión declarativa,
 * y vigilancia de cambio de cuenta en Freighter para desktop.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import * as FreighterAPI from "@stellar/freighter-api";
import { usePrivy } from "@privy-io/react-auth";
import * as sessionStore from "@/lib/sessionStore";
import { isMobileBrowser, isFreighterAvailable, connectWallet } from "@/lib/mobileWalletConnectors";
import { FREIGHTER_ID } from "@/lib/stellarWalletsKit";
import { isValidStellarAddress, getFriendlyWalletMessage } from "@/lib/walletErrors";

export const WALLET_KEY = sessionStore.WALLET_KEY;
export const ONBOARDED_KEY = sessionStore.ONBOARDED_KEY;
export const PROVIDER_KEY = sessionStore.PROVIDER_KEY;

/** Id de wallet de Stellar Wallets Kit (p. ej. "freighter", "albedo", "xbull"). */
export type WalletProvider = string;

export interface WalletSessionValue {
  /** Dirección de la sesión (la wallet con la que se inició sesión). */
  address: string | null;
  provider: WalletProvider | null;
  onboarded: boolean;
  /** true cuando ya se intentó cargar la sesión desde almacenamiento. */
  ready: boolean;
  /** Desktop + Freighter: la cuenta activa de la extensión NO es la de la sesión. */
  walletMismatch: boolean;
  /** Cuenta actualmente seleccionada en Freighter cuando hay mismatch. */
  activeAddress: string | null;
  /** Error de sesión o reconexión accionable para la UI. */
  sessionError: string | null;
  /** Indica si la sesión fue invalidada por expiración de tiempo (TTL). */
  isExpired: boolean;
  setSession: (address: string, provider: WalletProvider) => void;
  completeOnboarding: () => void;
  disconnect: () => void;
  reconnect: () => Promise<{ ok: boolean; error?: string }>;
  clearSessionError: () => void;
}

const Ctx = createContext<WalletSessionValue | null>(null);

export const useWalletSession = (): WalletSessionValue => {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error("useWalletSession must be used within WalletSessionProvider");
  return ctx;
};

export const WalletSessionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [address, setAddress] = useState<string | null>(null);
  const [provider, setProvider] = useState<WalletProvider | null>(null);
  const [onboarded, setOnboarded] = useState(false);
  const [ready, setReady] = useState(false);
  const [walletMismatch, setWalletMismatch] = useState(false);
  const [activeAddress, setActiveAddress] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState(false);

  // Sesión de Privy (login con correo/Google/Apple). La necesitamos para poder
  // cerrarla en `disconnect`: si no, Privy sigue `authenticated` y vuelve a
  // re-crear la sesión.
  const { authenticated: privyAuthenticated, logout: privyLogout } = usePrivy();

  // Cargar y validar la sesión UNA vez al inicio (con respaldo en cookie + TTL).
  useEffect(() => {
    const restored = sessionStore.restoreSession();
    setAddress(restored.address);
    setProvider(restored.provider);
    setOnboarded(restored.onboarded);
    setIsExpired(restored.isExpired);

    if (restored.isExpired) {
      setSessionError("Tu sesión ha expirado. Por favor reconecta tu wallet.");
    } else if (restored.isCorrupted) {
      setSessionError("Sesión inválida detectada y restablecida.");
    }

    setReady(true);
  }, []);

  const setSession = useCallback(
    (addr: string, prov: WalletProvider) => {
      const trimmed = addr?.trim();
      if (!trimmed || !isValidStellarAddress(trimmed)) {
        console.error("Dirección Stellar no válida para la sesión:", addr);
        setSessionError("Formato de wallet inválido.");
        return;
      }

      sessionStore.saveSession(trimmed, prov, true);
      setAddress(trimmed);
      setProvider(prov);
      setOnboarded(true);
      setWalletMismatch(false);
      setActiveAddress(null);
      setIsExpired(false);
      setSessionError(null);
    },
    []
  );

  const completeOnboarding = useCallback(() => {
    sessionStore.setItem(ONBOARDED_KEY, "1");
    setOnboarded(true);
  }, []);

  const clearSessionError = useCallback(() => {
    setSessionError(null);
  }, []);

  const disconnect = useCallback(() => {
    sessionStore.clearSession();
    setAddress(null);
    setProvider(null);
    setOnboarded(false);
    setWalletMismatch(false);
    setActiveAddress(null);
    setIsExpired(false);
    setSessionError(null);

    // Cierra también la sesión de Privy si aplica
    if (privyAuthenticated) {
      void Promise.resolve(privyLogout()).catch(() => {});
    }
  }, [privyAuthenticated, privyLogout]);

  // Reconexión unificada accionable
  const reconnect = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      setSessionError(null);
      const targetProvider = provider ?? sessionStore.getItem(PROVIDER_KEY) ?? FREIGHTER_ID;

      // Si es Freighter en desktop, intentar conectar directamente con la extensión
      if (targetProvider === FREIGHTER_ID && !isMobileBrowser()) {
        const isAvail = await isFreighterAvailable();
        if (!isAvail) {
          const err = "Freighter no está disponible. Verifica que la extensión esté instalada y desbloqueada.";
          setSessionError(err);
          return { ok: false, error: err };
        }
        const access = await FreighterAPI.requestAccess();
        if (access?.error) {
          const err = getFriendlyWalletMessage(access.error);
          setSessionError(err);
          return { ok: false, error: err };
        }
        if (!access?.address) {
          const err = "No se obtuvo la dirección de la wallet.";
          setSessionError(err);
          return { ok: false, error: err };
        }
        setSession(access.address, FREIGHTER_ID);
        return { ok: true };
      }

      // Otras wallets o entorno móvil: abrir modal de conexión
      const result = await connectWallet();
      if (!result.ok) {
        if (!result.cancelled) {
          setSessionError(result.error);
        }
        return { ok: false, error: result.error };
      }

      setSession(result.address, result.provider);
      return { ok: true };
    } catch (err: unknown) {
      const friendly = getFriendlyWalletMessage(err);
      setSessionError(friendly);
      return { ok: false, error: friendly };
    }
  }, [provider, setSession]);

  // Desktop + Freighter: detectar cambio de cuenta en la extensión.
  useEffect(() => {
    if (!ready || !address) return;
    if (provider !== FREIGHTER_ID) return;
    if (isMobileBrowser()) return;

    let cancelled = false;

    const check = async () => {
      try {
        const res = await FreighterAPI.getAddress();
        if (cancelled) return;
        const active = res?.address || null;
        if (!active || active === address) {
          setWalletMismatch(false);
          setActiveAddress(null);
        } else {
          setActiveAddress(active);
          setWalletMismatch(true);
        }
      } catch {
        if (!cancelled) {
          setWalletMismatch(false);
          setActiveAddress(null);
        }
      }
    };

    void check();
    const id = setInterval(check, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [ready, address, provider]);

  return (
    <Ctx.Provider
      value={{
        address,
        provider,
        onboarded,
        ready,
        walletMismatch,
        activeAddress,
        sessionError,
        isExpired,
        setSession,
        completeOnboarding,
        disconnect,
        reconnect,
        clearSessionError,
      }}
    >
      {children}
    </Ctx.Provider>
  );
};
