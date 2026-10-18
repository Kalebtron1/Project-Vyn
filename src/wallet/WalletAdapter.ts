/**
 * WalletAdapter — provider-agnostic wallet interface.
 *
 * All wallet operations in the app go through this contract so that
 * swapping the underlying provider (Freighter, WalletConnect, etc.)
 * only requires a new adapter, not changes to UI components.
 *
 * Adapter contract:
 *   connect()           — request access and return the public key.
 *                         Persists the address to localStorage under
 *                         "vinculo_wallet" so session restore works.
 *   sign(xdr, network)  — sign a base64-XDR transaction string and
 *                         return the signed XDR.
 *   disconnect()        — clear session storage and redirect to /login.
 *   getAddress()        — return the persisted address (or null).
 *   isConnected()       — return true if the provider extension is present.
 */
export interface WalletAdapter {
  connect(): Promise<string>;
  sign(xdr: string, networkPassphrase: string): Promise<string>;
  signChallenge(nonce: string, address?: string): Promise<string>;
  disconnect(): void;
  getAddress(): string | null;
  isConnected(): Promise<boolean>;
}
