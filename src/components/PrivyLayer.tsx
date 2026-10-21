/**
 * PrivyLayer — SDK de Privy (login con correo/Google) cargado bajo demanda.
 *
 * Privy y sus dependencias (viem, WalletConnect, Coinbase…) pesan ~2 MB. Esta capa
 * se monta junto a las rutas, no alrededor de ellas (ver `PrivyGate`), y la app sólo
 * habla con Privy vía `privyBridge`. Así una sesión de Freighter o del kit nunca la
 * descarga. Los modales de Privy se dibujan en un portal, así que no necesitan
 * envolver la app.
 */

import { PrivyProvider } from "@privy-io/react-auth";
import { PrivyBridge } from "@/components/PrivyBridge";

const PrivyLayer = () => (
  <PrivyProvider
    appId={import.meta.env.VITE_PRIVY_APP_ID}
    config={{
      loginMethods: ["email", "google"],
      appearance: { theme: "light" },
    }}
  >
    <PrivyBridge />
  </PrivyProvider>
);

export default PrivyLayer;
