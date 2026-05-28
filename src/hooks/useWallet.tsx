import { useState, useEffect } from "react";
import { isFreighterAvailable, isMobileBrowser } from "@/lib/mobileWalletConnectors";
import { walletAdapter } from "@/wallet";

export type WalletStatus = "loading" | "connected" | "disconnected" | "missing";

export const useWallet = () => {
  const [wallet, setWallet] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [walletStatus, setWalletStatus] = useState<WalletStatus>("loading");

  useEffect(() => {
    const savedWallet = localStorage.getItem("vinculo_wallet");
    setWallet(savedWallet);

    const checkStatus = async () => {
      if (!savedWallet) {
        setWalletStatus("missing");
      } else {
        // On desktop, check if the extension that was used is still available
        const savedProvider = localStorage.getItem("vinculo_wallet_provider");
        const onDesktop = !isMobileBrowser();
        const freighterAvailable = await isFreighterAvailable();
        if (onDesktop && savedProvider === "freighter" && !freighterAvailable) {
          // Wallet address is saved but Freighter is gone (removed/locked)
          setWalletStatus("disconnected");
        } else {
          setWalletStatus("connected");
        }
      }

      setLoading(false);
    };

    void checkStatus();
  }, []);

  const setWalletAddress = (address: string) => {
    localStorage.setItem("vinculo_wallet", address);
    setWallet(address);
    setWalletStatus("connected");
  };

  // Short display format: GDAH5...J5W
  const shortWallet = wallet
    ? `${wallet.substring(0, 5)}...${wallet.substring(wallet.length - 4)}`
    : "";

  const disconnect = () => {
    walletAdapter.disconnect();
  };

  return { wallet, loading, walletStatus, shortWallet, disconnect, setWalletAddress };
};
