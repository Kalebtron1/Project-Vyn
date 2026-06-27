import type { WalletAdapter } from "./WalletAdapter";
import {
  connectWallet,
  signTransactionXdr,
  getSavedProvider,
  saveProvider,
} from "@/lib/mobileWalletConnectors";
import * as sessionStore from "@/lib/sessionStore";
import {
  WALLET_KEY,
  ONBOARDED_KEY,
  PROVIDER_KEY,
} from "@/context/WalletSessionContext";

const STORAGE_KEY = WALLET_KEY;

/**
 * StellarWalletAdapter — provider-agnostic WalletAdapter implementation.
 *
 * Delegates connect() and sign() to mobileWalletConnectors, which picks
 * Freighter on desktop (when available) and Albedo on mobile automatically.
 * Adding a new provider only requires updating mobileWalletConnectors.ts.
 */
export class StellarWalletAdapter implements WalletAdapter {
  async isConnected(): Promise<boolean> {
    return !!sessionStore.getItem(STORAGE_KEY);
  }

  async connect(): Promise<string> {
    const result = await connectWallet();
    if (!result.ok) {
      throw new Error(result.error);
    }
    saveProvider(result.provider);
    sessionStore.setItem(STORAGE_KEY, result.address);
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
    // Limpia la sesión durable. La redirección a /login la hace el guard al
    // quedar la dirección en null (preferir el flujo de router del contexto).
    sessionStore.removeItem(STORAGE_KEY);
    sessionStore.removeItem(ONBOARDED_KEY);
    sessionStore.removeItem(PROVIDER_KEY);
  }

  getAddress(): string | null {
    return sessionStore.getItem(STORAGE_KEY);
  }
}
