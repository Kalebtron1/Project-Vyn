import type { WalletAdapter } from "./WalletAdapter";
import {
  connectWallet,
  signTransactionXdr,
  getSavedProvider,
  saveProvider,
} from "@/lib/mobileWalletConnectors";

const STORAGE_KEY = "vinculo_wallet";

/**
 * StellarWalletAdapter — provider-agnostic WalletAdapter implementation.
 *
 * Delegates connect() and sign() to mobileWalletConnectors, which picks
 * Freighter on desktop (when available) and Albedo on mobile automatically.
 * Adding a new provider only requires updating mobileWalletConnectors.ts.
 */
export class StellarWalletAdapter implements WalletAdapter {
  async isConnected(): Promise<boolean> {
    return !!localStorage.getItem(STORAGE_KEY);
  }

  async connect(): Promise<string> {
    const result = await connectWallet();
    if (!result.ok) {
      throw new Error(result.error);
    }
    saveProvider(result.provider);
    localStorage.setItem(STORAGE_KEY, result.address);
    return result.address;
  }

  async sign(xdr: string, _networkPassphrase: string): Promise<string> {
    const provider = getSavedProvider();
    const result = await signTransactionXdr(xdr, provider);
    if (!result.ok) {
      throw new Error(result.error);
    }
    return result.signedXdr;
  }

  disconnect(): void {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("vinculo_onboarded");
    localStorage.removeItem("vinculo_wallet_provider");
    window.location.href = "/login";
  }

  getAddress(): string | null {
    return localStorage.getItem(STORAGE_KEY);
  }
}
