export type { WalletAdapter } from "./WalletAdapter";
export { FreighterAdapter } from "./FreighterAdapter"; // kept for back-compat
export { StellarWalletAdapter } from "./StellarWalletAdapter";

import { StellarWalletAdapter } from "./StellarWalletAdapter";

/**
 * Singleton adapter used throughout the app.
 * Backed by StellarWalletAdapter which auto-selects Freighter (desktop)
 * or Albedo (mobile) via mobileWalletConnectors.
 */
export const walletAdapter = new StellarWalletAdapter();
