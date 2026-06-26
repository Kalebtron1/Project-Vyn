/**
 * useMobileWallet
 *
 * Thin React hook that wraps the connector abstraction and exposes:
 *  - connect()                    → get public key (auto-picks provider)
 *  - connectToProvider(provider)  → connect to specific provider (Freighter, Albedo, WalletConnect)
 *  - sign(xdr)                    → sign a transaction XDR
 *  - isMobile                     → boolean
 *  - provider                      → current provider ("freighter" | "albedo" | "walletconnect")
 *  - isFreighterReady             → boolean (extension detected)
 *  - availableProviders           → list of available providers for this environment
 */

import { useState, useEffect } from "react";
import {
  connectWallet,
  connectWithProvider,
  signTransactionXdr,
  isMobileBrowser,
  isFreighterAvailable,
  getSavedProvider,
  saveProvider,
  type ConnectResult,
  type SignResult,
} from "@/lib/mobileWalletConnectors";

export function useMobileWallet() {
  const [isMobile] = useState<boolean>(() => isMobileBrowser());
  const [freighterReady, setFreighterReady] = useState<boolean>(false);
  const [provider, setProvider] = useState<"freighter" | "albedo" | "walletconnect">(
    getSavedProvider
  );

  // Poll for Freighter extension on desktop (it may inject after page load)
  useEffect(() => {
    if (isMobile) return;

    const check = async () => {
      const available = await isFreighterAvailable();
      setFreighterReady(available);
      // On desktop, Freighter wins whenever it is available.
      if (available) {
        setProvider("freighter");
      }
    };

    void check();
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, [isMobile]);

  // Compute available providers based on environment
  const availableProviders: ("freighter" | "albedo" | "walletconnect")[] = isMobile
    ? ["albedo", "walletconnect"]
    : freighterReady
      ? ["freighter", "albedo", "walletconnect"]
      : ["albedo", "walletconnect"];

  const connect = async (): Promise<ConnectResult> => {
    const result = await connectWallet();
    if (result.ok) {
      saveProvider(result.provider);
      setProvider(result.provider);
    }
    return result;
  };

  const connectToProvider = async (
    targetProvider: "freighter" | "albedo" | "walletconnect"
  ): Promise<ConnectResult> => {
    const result = await connectWithProvider(targetProvider);
    if (result.ok) {
      saveProvider(result.provider);
      setProvider(result.provider);
    }
    return result;
  };

  const sign = async (xdr: string): Promise<SignResult> => {
    return signTransactionXdr(xdr, provider);
  };

  return {
    isMobile,
    provider,
    isFreighterReady: freighterReady,
    availableProviders,
    connect,
    connectToProvider,
    sign,
  };
}
