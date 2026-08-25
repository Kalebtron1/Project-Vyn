import { useState, useEffect } from "react";
import { isFreighterAvailable, isMobileBrowser } from "@/lib/mobileWalletConnectors";
import { FREIGHTER_ID } from "@/lib/stellarWalletsKit";
import { useWalletSession } from "@/context/WalletSessionContext";

export type WalletStatus = "loading" | "connected" | "disconnected" | "missing";

/**
 * useWallet — vista de la sesión para la UI.
 *
 * La fuente de verdad es WalletSessionContext (cargado una vez por encima del
 * router). Este hook deriva el estado de presentación, maneja reconexión,
 * supervisa la disponibilidad de extensiones en desktop, y expone errores
 * accionables de sesión.
 */
export const useWallet = () => {
  const {
    address,
    provider,
    ready,
    walletMismatch,
    activeAddress,
    sessionError,
    isExpired,
    disconnect: ctxDisconnect,
    reconnect: ctxReconnect,
    clearSessionError,
    setSession,
  } = useWalletSession();

  const [freighterGone, setFreighterGone] = useState(false);

  // Escritorio + Freighter: detectar que la extensión se quitó/bloqueó.
  useEffect(() => {
    if (!address || provider !== FREIGHTER_ID || isMobileBrowser()) {
      setFreighterGone(false);
      return;
    }
    let cancelled = false;
    const check = async () => {
      const available = await isFreighterAvailable();
      if (!cancelled) setFreighterGone(!available);
    };
    void check();
    const id = setInterval(check, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [address, provider]);

  const walletStatus: WalletStatus = !ready
    ? "loading"
    : !address
    ? "missing"
    : freighterGone || isExpired
    ? "disconnected"
    : "connected";

  // Short display format: GDAH5...J5W
  const shortWallet = address
    ? `${address.substring(0, 5)}...${address.substring(address.length - 4)}`
    : "";

  const setWalletAddress = (newAddress: string) => {
    setSession(newAddress, provider ?? FREIGHTER_ID);
  };

  return {
    wallet: address,
    provider,
    loading: !ready,
    walletStatus,
    shortWallet,
    disconnect: ctxDisconnect,
    reconnect: ctxReconnect,
    setWalletAddress,
    // Aviso de cambio de cuenta en Freighter (desktop).
    walletMismatch,
    activeAddress,
    sessionError,
    isExpired,
    clearSessionError,
  };
};
