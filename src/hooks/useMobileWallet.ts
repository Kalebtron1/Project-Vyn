/**
 * useMobileWallet
 *
 * Hook React que envuelve la capa de conectores (Stellar Wallets Kit) y expone:
 *  - connect()  → abre el modal multi-wallet y obtiene la dirección pública
 *  - sign(xdr)  → firma una transacción XDR con la wallet seleccionada
 *  - isMobile   → boolean
 *  - provider   → id de wallet del kit (string)
 *
 * El nombre se conserva por compatibilidad con sus consumidores
 * (DepositModal, Tesoreria, Retiros), aunque ya no es exclusivo de móvil.
 */

import { useState } from "react";
import {
  connectWallet,
  signTransactionXdr,
  isMobileBrowser,
  getSavedProvider,
  saveProvider,
  type WalletId,
  type ConnectResult,
  type SignResult,
} from "@/lib/mobileWalletConnectors";

export function useMobileWallet() {
  const [isMobile] = useState<boolean>(() => isMobileBrowser());
  const [provider, setProvider] = useState<WalletId>(getSavedProvider);

  const connect = async (): Promise<ConnectResult> => {
    const result = await connectWallet();
    if (result.ok) {
      saveProvider(result.provider);
      setProvider(result.provider);
    }
    return result;
  };

  const sign = async (xdr: string): Promise<SignResult> => {
    return signTransactionXdr(xdr, provider);
  };

  return {
    isMobile,
    provider,
    connect,
    sign,
  };
}
