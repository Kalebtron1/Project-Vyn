/**
 * WalletSessionContext — fuente única de verdad de la sesión de wallet.
 *
 * Carga la sesión UNA sola vez al arrancar (con respaldo en cookie) y la mantiene
 * en memoria por encima del router. Así, navegar entre rutas (incluido volver a
 * "Inicio") nunca vuelve a re-derivar la sesión desde `localStorage` ni dispara un
 * login espurio.
 *
 * Además, en escritorio con Freighter, vigila la cuenta activa de la extensión:
 * si el usuario cambia de cuenta, expone `walletMismatch` para avisarle (sin
 * borrar la sesión) que regrese a la wallet original.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import * as FreighterAPI from "@stellar/freighter-api";
import * as sessionStore from "@/lib/sessionStore";
import { isMobileBrowser } from "@/lib/mobileWalletConnectors";

export const WALLET_KEY = "vinculo_wallet";
export const ONBOARDED_KEY = "vinculo_onboarded";
export const PROVIDER_KEY = "vinculo_wallet_provider";

export type WalletProvider = "freighter" | "albedo";

interface WalletSessionValue {
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
  setSession: (address: string, provider: WalletProvider) => void;
  completeOnboarding: () => void;
  disconnect: () => void;
}

const Ctx = createContext<WalletSessionValue | null>(null);

export const useWalletSession = (): WalletSessionValue => {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error("useWalletSession must be used within WalletSessionProvider");
  return ctx;
};

const normalizeProvider = (v: string | null): WalletProvider | null =>
  v === "freighter" || v === "albedo" ? v : null;

export const WalletSessionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [address, setAddress] = useState<string | null>(null);
  const [provider, setProvider] = useState<WalletProvider | null>(null);
  const [onboarded, setOnboarded] = useState(false);
  const [ready, setReady] = useState(false);
  const [walletMismatch, setWalletMismatch] = useState(false);
  const [activeAddress, setActiveAddress] = useState<string | null>(null);

  // Cargar la sesión UNA vez (con respaldo en cookie + rehidratación de localStorage).
  useEffect(() => {
    setAddress(sessionStore.getItem(WALLET_KEY));
    setProvider(normalizeProvider(sessionStore.getItem(PROVIDER_KEY)));
    setOnboarded(sessionStore.getItem(ONBOARDED_KEY) === "1");
    setReady(true);
  }, []);

  const setSession = useCallback(
    (addr: string, prov: WalletProvider) => {
      sessionStore.setItem(WALLET_KEY, addr);
      sessionStore.setItem(PROVIDER_KEY, prov);
      sessionStore.setItem(ONBOARDED_KEY, "1");
      setAddress(addr);
      setProvider(prov);
      setOnboarded(true);
      setWalletMismatch(false);
      setActiveAddress(null);
    },
    []
  );

  const completeOnboarding = useCallback(() => {
    sessionStore.setItem(ONBOARDED_KEY, "1");
    setOnboarded(true);
  }, []);

  const disconnect = useCallback(() => {
    sessionStore.removeItem(WALLET_KEY);
    sessionStore.removeItem(ONBOARDED_KEY);
    sessionStore.removeItem(PROVIDER_KEY);
    setAddress(null);
    setProvider(null);
    setOnboarded(false);
    setWalletMismatch(false);
    setActiveAddress(null);
  }, []);

  // Desktop + Freighter: detectar cambio de cuenta en la extensión.
  useEffect(() => {
    if (!ready || !address) return;
    if (provider !== "freighter") return;
    if (isMobileBrowser()) return;

    let cancelled = false;

    const check = async () => {
      try {
        const res = await FreighterAPI.getAddress(); // no abre prompt si ya hay acceso
        if (cancelled) return;
        const active = res?.address || null;
        // Sin cuenta activa (bloqueada / acceso revocado): lo maneja useWallet
        // como "disconnected"; aquí no lo tratamos como mismatch.
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
        setSession,
        completeOnboarding,
        disconnect,
      }}
    >
      {children}
    </Ctx.Provider>
  );
};
