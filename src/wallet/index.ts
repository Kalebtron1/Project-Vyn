export type { WalletAdapter } from "./WalletAdapter";
export { StellarWalletAdapter } from "./StellarWalletAdapter";

import { StellarWalletAdapter } from "./StellarWalletAdapter";

/**
 * Singleton adapter used throughout the app.
 * Backed by StellarWalletAdapter, which delegates to Stellar Wallets Kit
 * (see src/lib/stellarWalletsKit.ts) for both desktop (Freighter, xBull,
 * Lobstr, Hana, Rabet) and mobile (Albedo) providers via its selection modal.
 */
export const walletAdapter = new StellarWalletAdapter();
