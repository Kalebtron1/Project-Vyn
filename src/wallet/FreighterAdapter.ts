import * as FreighterAPI from "@stellar/freighter-api";
import type { WalletAdapter } from "./WalletAdapter";
import * as sessionStore from "@/lib/sessionStore";
import { FREIGHTER_ID } from "@/lib/stellarWalletsKit";

const STORAGE_KEY = sessionStore.WALLET_KEY;

/**
 * FreighterAdapter — WalletAdapter implementation backed by the
 * Freighter browser extension (@stellar/freighter-api).
 */
export class FreighterAdapter implements WalletAdapter {
  async isConnected(): Promise<boolean> {
    try {
      const result = await FreighterAPI.isConnected();
      // freighter-api v4 returns { isConnected: boolean }
      return typeof result === "object" ? result.isConnected : Boolean(result);
    } catch {
      return false;
    }
  }

  async connect(): Promise<string> {
    const response = await FreighterAPI.requestAccess();
    if (response.error) throw new Error(response.error);
    if (!response.address) throw new Error("No se obtuvo la dirección de la wallet.");
    sessionStore.saveSession(response.address, FREIGHTER_ID);
    return response.address;
  }

  async sign(xdr: string, networkPassphrase: string): Promise<string> {
    const result = await FreighterAPI.signTransaction(xdr, { networkPassphrase });
    if (result.error || !result.signedTxXdr) {
      throw new Error(result.error || "Firma rechazada.");
    }
    return result.signedTxXdr;
  }

  disconnect(): void {
    sessionStore.clearSession();
    window.location.href = "/login";
  }

  getAddress(): string | null {
    return sessionStore.getItem(STORAGE_KEY);
  }
}
