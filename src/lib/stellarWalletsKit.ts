/**
 * Stellar Wallets Kit — singleton de conexión multi-wallet.
 *
 * Sustituye las integraciones directas de Freighter/Albedo por el kit de
 * Creit Tech (@creit.tech/stellar-wallets-kit), que expone un modal nativo
 * donde el usuario elige entre varias wallets (Freighter, Albedo, xBull,
 * Lobstr, Hana, Rabet) y unifica las llamadas de conexión y firma.
 *
 * El kit (v2.x) es una clase ESTÁTICA: se inicializa una sola vez con
 * `init(...)` y todas las operaciones son métodos estáticos. Aquí garantizamos
 * esa inicialización única y exponemos helpers de alto nivel.
 *
 * Los ids de wallet del kit coinciden con los `provider` que ya persistíamos
 * antes (`"freighter"`, `"albedo"`), así que las sesiones existentes siguen
 * siendo válidas sin migración.
 */

import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";
import { FREIGHTER_ID, FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { ALBEDO_ID, AlbedoModule } from "@creit.tech/stellar-wallets-kit/modules/albedo";
import { xBullModule } from "@creit.tech/stellar-wallets-kit/modules/xbull";
import { LobstrModule } from "@creit.tech/stellar-wallets-kit/modules/lobstr";
import { HanaModule } from "@creit.tech/stellar-wallets-kit/modules/hana";
import { RabetModule } from "@creit.tech/stellar-wallets-kit/modules/rabet";
import { Networks as SdkNetworks } from "@stellar/stellar-sdk";
import * as sessionStore from "@/lib/sessionStore";

/** Passphrase de la red activa. Centralizado para conexión + firma. */
export const NETWORK_PASSPHRASE = SdkNetworks.TESTNET;

export { FREIGHTER_ID, ALBEDO_ID };

// Debe coincidir con PROVIDER_KEY en WalletSessionContext / mobileWalletConnectors.
const PROVIDER_KEY = "vinculo_wallet_provider";

let initialized = false;

/** Inicializa el kit una sola vez y devuelve la clase estática. */
export function getKit(): typeof StellarWalletsKit {
  if (!initialized) {
    StellarWalletsKit.init({
      network: Networks.TESTNET,
      // Restaura la última wallet usada; por defecto Freighter.
      selectedWalletId: sessionStore.getItem(PROVIDER_KEY) ?? FREIGHTER_ID,
      modules: [
        new FreighterModule(),
        new AlbedoModule(),
        new xBullModule(),
        new LobstrModule(),
        new HanaModule(),
        new RabetModule(),
      ],
    });
    initialized = true;
  }
  return StellarWalletsKit;
}

/**
 * Abre el modal de selección de wallet. Resuelve con la dirección pública y el
 * id de la wallet elegida. Lanza si el usuario cierra el modal (lo mapea el
 * llamador a "cancelado").
 */
export async function openWalletModal(): Promise<{ address: string; walletId: string }> {
  const kit = getKit();
  const { address } = await kit.authModal();
  return { address, walletId: kit.selectedModule.productId };
}
