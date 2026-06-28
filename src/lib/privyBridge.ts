/**
 * privyBridge — puente entre el SDK de Privy (que firma vía hooks React) y la capa
 * estática `signTransactionXdr` que usa el resto de la app (DepositModal, CreditSection,
 * Tesoreria, Retiros). Reemplaza al antiguo puente de Accesly.
 *
 * `PrivyBridge` (montado dentro de `<PrivyProvider>`) registra aquí:
 *  - la función de firma (construida con `useSignRawHash` + Stellar SDK), y
 *  - publica el evento de conexión (wallet Stellar lista) para que Login abra la sesión.
 *
 * Stellar en Privy es "raw sign" (Ed25519): firmamos el hash de la transacción y
 * adjuntamos la firma nosotros. Por eso el bridge entrega directamente el XDR ya firmado.
 */

/** Id de provider de la sesión cuando el usuario entró con Privy (correo/Google/Apple). */
export const PRIVY_PROVIDER = "privy";

type PrivySignFn = (xdr: string) => Promise<string>;

let signer: PrivySignFn | null = null;

/** Lo llama `PrivyBridge` al montar/desmontar dentro del provider. */
export function registerPrivySigner(fn: PrivySignFn | null): void {
  signer = fn;
}

/** ¿Hay una sesión Privy lista para firmar? */
export function isPrivyReady(): boolean {
  return signer !== null;
}

/** Firma un XDR con la wallet Stellar de Privy. Devuelve el XDR firmado. */
export async function privySign(xdr: string): Promise<string> {
  if (!signer) {
    throw new Error("Privy no está listo. Vuelve a iniciar sesión con tu correo.");
  }
  return signer(xdr);
}

// ─── Evento de conexión ──────────────────────────────────────────────────────
export interface PrivyConnectedWallet {
  stellarAddress: string;
  email?: string;
}

type ConnectListener = (wallet: PrivyConnectedWallet) => void;
const connectListeners = new Set<ConnectListener>();

/** Suscribe un listener a la conexión de Privy. Devuelve la función para desuscribir. */
export function onPrivyConnected(cb: ConnectListener): () => void {
  connectListeners.add(cb);
  return () => { connectListeners.delete(cb); };
}

/** Lo llama `PrivyBridge` cuando la wallet Stellar del usuario está lista. */
export function notifyPrivyConnected(wallet: PrivyConnectedWallet): void {
  connectListeners.forEach((cb) => {
    try { cb(wallet); } catch { /* un listener no debe romper a los demás */ }
  });
}
