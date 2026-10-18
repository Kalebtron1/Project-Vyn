import { useState, useEffect } from "react";
import { isFreighterAvailable, isMobileBrowser } from "@/lib/mobileWalletConnectors";
import { FREIGHTER_ID } from "@/lib/stellarWalletsKit";
import { useWalletSession } from "@/context/WalletSessionContext";

export type WalletStatus = "loading" | "connected" | "disconnected" | "missing";

/**
 * useWallet — vista de la sesión para la UI.
 *
 * La fuente de verdad es WalletSessionContext (cargado una vez por encima del
 * router). Este hook solo deriva el estado de presentación y, en escritorio con
 * Freighter, marca "disconnected" si la extensión deja de estar disponible.
 * Mantiene su API pública previa para no romper a los consumidores.
 *
 * Notas por provider:
 *  - freighter  Soporta polling silencioso para detectar extensión no disponible.
 *  - lobstr     No expone API de polling silencioso; no se sondea el estado de la
 *               extensión. La sesión se considera válida mientras el usuario no
 *               cierre sesión explícitamente.
 *  - albedo     Igual que lobstr: sin polling.
 *  - privy      Gestionado por Privy SDK; sin polling local.
 */
export const useWallet = () => {
  const {
    address,
    provider,
    ready,
    walletMismatch,
    activeAddress,
    disconnect: ctxDisconnect,
    setSession,
  } = useWalletSession();

  const [freighterGone, setFreighterGone] = useState(false);

  // Escritorio + Freighter: detectar que la extensión se quitó/bloqueó.
  // LOBSTR y otros wallets del kit no exponen una API de polling silencioso,
  // por lo que el sondeo sólo se activa cuando el provider es Freighter.
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
    : freighterGone
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
    loading: !ready,
    walletStatus,
    shortWallet,
    disconnect: ctxDisconnect,
    setWalletAddress,
    // Aviso de cambio de cuenta en Freighter (desktop).
    // Para LOBSTR y otros wallets del kit este valor siempre es false.
    walletMismatch,
    activeAddress,
  };
};
