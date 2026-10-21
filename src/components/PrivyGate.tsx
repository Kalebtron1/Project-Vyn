/**
 * PrivyGate — decide cuándo montar `PrivyLayer` (el SDK de Privy, ~2 MB).
 *
 * Se monta cuando hace falta:
 *  - en /login, para poder entrar con correo;
 *  - en una sesión de Privy, para firmar y exportar la wallet;
 *  - cuando algo lo pide vía `privyBridge` (`requested`).
 * Una vez montado se queda: desmontarlo cerraría sus modales y reiniciaría el SDK.
 */

import { lazy, Suspense, useState } from "react";
import { useLocation } from "react-router-dom";
import * as sessionStore from "@/lib/sessionStore";
import { PRIVY_PROVIDER, usePrivyBridge } from "@/lib/privyBridge";
import {
  PROVIDER_KEY,
  WALLET_KEY,
  useWalletSession,
} from "@/context/WalletSessionContext";

const loadPrivyLayer = () => import("@/components/PrivyLayer");
const PrivyLayer = lazy(loadPrivyLayer);

// Al arrancar: si la sesión guardada es de Privy, o no hay sesión (la app va a mandar
// al usuario a /login), la descarga empieza ya, en paralelo con la página y no
// después de ella. Una sesión de Freighter/kit no descarga Privy.
if (
  sessionStore.getItem(PROVIDER_KEY) === PRIVY_PROVIDER ||
  !sessionStore.getItem(WALLET_KEY)
) {
  void loadPrivyLayer();
}

export function PrivyGate() {
  const { pathname } = useLocation();
  const { address, onboarded, provider, ready } = useWalletSession();
  const { requested } = usePrivyBridge();

  // En /login con sesión completa, Login redirige a "/" sin necesitar Privy.
  const onLogin = pathname === "/login" && ready && !(address && onboarded);
  const needed = requested || provider === PRIVY_PROVIDER || onLogin;

  const [mounted, setMounted] = useState(false);
  if (needed && !mounted) setMounted(true);
  if (!mounted) return null;

  return (
    <Suspense fallback={null}>
      <PrivyLayer />
    </Suspense>
  );
}
