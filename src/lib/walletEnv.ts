/**
 * Helpers de wallet sin dependencias pesadas.
 *
 * Los usa la raíz de la app (`WalletSessionContext`), que se carga en cada
 * visita. Importarlos desde `stellarWalletsKit` o `mobileWalletConnectors`
 * arrastraría al bundle inicial el kit de wallets y el Stellar SDK (~1.7 MB),
 * que sólo necesitan las páginas que conectan o firman.
 */

/** Id de Freighter en Stellar Wallets Kit (mismo valor que `FREIGHTER_ID` del kit). */
export const FREIGHTER_ID = "freighter";

export function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(
    navigator.userAgent
  );
}
