/**
 * privyBridge — puente entre el SDK de Privy (que vive en `PrivyLayer`, cargado bajo
 * demanda) y el resto de la app, que nunca importa Privy directamente.
 *
 * `PrivyBridge` (montado dentro de `<PrivyProvider>`) registra aquí:
 *  - la función de firma (construida con `useSignRawHash` + Stellar SDK),
 *  - las acciones `login`, `logout` y `exportWallet`,
 *  - el estado del SDK (`ready`, `authenticated`, email), y
 *  - publica el evento de conexión (wallet Stellar lista) para que Login abra la sesión.
 *
 * Como Privy puede no estar cargado todavía, las acciones se encolan o esperan a que
 * el SDK esté listo, y piden montar la capa (`requested`) si hace falta.
 *
 * Stellar en Privy es "raw sign" (Ed25519): firmamos el hash de la transacción y
 * adjuntamos la firma nosotros. Por eso el bridge entrega directamente el XDR ya firmado.
 */

import { useSyncExternalStore } from "react";

/** Id de provider de la sesión cuando el usuario entró con Privy (correo/Google/Apple). */
export const PRIVY_PROVIDER = "privy";

/** Cuánto esperar a que Privy cargue antes de dar por fallida una firma o un export. */
const PRIVY_WAIT_MS = 20_000;

// ─── Estado del SDK ──────────────────────────────────────────────────────────
export interface PrivyBridgeState {
  /** Algo pidió montar la capa de Privy fuera de las rutas que ya la montan. */
  requested: boolean;
  /** `PrivyBridge` está montado (el SDK ya se descargó). */
  loaded: boolean;
  /** El SDK terminó de inicializar (`usePrivy().ready`). */
  ready: boolean;
  authenticated: boolean;
  email?: string;
  /** El modal de login de Privy está abierto. */
  modalOpen: boolean;
  /** Último error al iniciar sesión (`at` distingue dos errores con el mismo texto). */
  loginError?: { message: string; at: number };
}

let state: PrivyBridgeState = {
  requested: false,
  loaded: false,
  ready: false,
  authenticated: false,
  modalOpen: false,
};
const stateListeners = new Set<() => void>();
// Promesas pendientes (firma, export) que esperan a que cambie el estado o el signer.
const waiters = new Set<() => void>();

function subscribeState(cb: () => void): () => void {
  stateListeners.add(cb);
  return () => { stateListeners.delete(cb); };
}

function getState(): PrivyBridgeState {
  return state;
}

function runWaiters(): void {
  waiters.forEach((check) => check());
}

/** Lo llama `PrivyBridge` para publicar el estado del SDK. */
export function setPrivyState(patch: Partial<PrivyBridgeState>): void {
  const changed = (Object.keys(patch) as (keyof PrivyBridgeState)[]).some(
    (key) => state[key] !== patch[key]
  );
  if (!changed) return;
  state = { ...state, ...patch };
  if (!state.authenticated) loggingOut = false;
  stateListeners.forEach((cb) => cb());
  flushPending();
  runWaiters();
}

/** Lo llama `PrivyBridge` cuando un intento de login falla (p. ej. Google rechazado). */
export function reportPrivyLoginError(message: string): void {
  setPrivyState({ loginError: { message, at: Date.now() } });
}

/** Estado de Privy para componentes React (se re-renderiza al cambiar). */
export function usePrivyBridge(): PrivyBridgeState {
  return useSyncExternalStore(subscribeState, getState);
}

function requestPrivyLayer(): void {
  if (!state.requested) setPrivyState({ requested: true });
}

/** Resuelve con `get()` en cuanto devuelva algo; falla tras `PRIVY_WAIT_MS`. */
function waitFor<T>(get: () => T | null, errorMessage: string): Promise<T> {
  const now = get();
  if (now) return Promise.resolve(now);
  requestPrivyLayer();
  return new Promise<T>((resolve, reject) => {
    const check = () => {
      const value = get();
      if (!value) return;
      cleanup();
      resolve(value);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(errorMessage));
    }, PRIVY_WAIT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      waiters.delete(check);
    };
    waiters.add(check);
  });
}

// ─── Firma ───────────────────────────────────────────────────────────────────
type PrivySignFn = (xdr: string) => Promise<string>;

let signer: PrivySignFn | null = null;

/** Lo llama `PrivyBridge` al montar/desmontar dentro del provider. */
export function registerPrivySigner(fn: PrivySignFn | null): void {
  signer = fn;
  runWaiters();
}

/** ¿Hay una sesión Privy lista para firmar? */
export function isPrivyReady(): boolean {
  return signer !== null;
}

/**
 * Firma un XDR con la wallet Stellar de Privy. Devuelve el XDR firmado.
 * Tras una recarga Privy puede seguir cargando: espera al signer en vez de fallar.
 */
export async function privySign(xdr: string): Promise<string> {
  const sign = await waitFor(
    () => signer,
    "Privy no está listo. Vuelve a iniciar sesión con tu correo."
  );
  return sign(xdr);
}

// ─── Acciones ────────────────────────────────────────────────────────────────
export interface PrivyActions {
  login: () => void;
  logout: () => Promise<void>;
  exportWallet: (address: string) => Promise<void>;
}

let actions: PrivyActions | null = null;
// Pedidos hechos antes de que Privy estuviera listo; se ejecutan al estarlo.
let pendingLogin = false;
let pendingLogout = false;
let loggingOut = false;

/** Lo llama `PrivyBridge` con las acciones del SDK (o `null` al desmontar). */
export function registerPrivyActions(next: PrivyActions | null): void {
  actions = next;
  flushPending();
  runWaiters();
}

// `loggingOut` sigue activo hasta que Privy reporte `authenticated: false` (ver
// `setPrivyState`), no sólo hasta que resuelva `logout()`: así ningún evento de
// conexión tardío vuelve a abrir la sesión. Si el logout falla, se libera.
function runLogout(current: PrivyActions): Promise<void> {
  loggingOut = true;
  return Promise.resolve()
    .then(() => current.logout())
    .catch(() => { loggingOut = false; });
}

function flushPending(): void {
  if (!actions || !state.ready) return;
  let logoutDone: Promise<void> = Promise.resolve();
  if (pendingLogout) {
    pendingLogout = false;
    if (state.authenticated) logoutDone = runLogout(actions);
  }
  if (pendingLogin) {
    pendingLogin = false;
    const current = actions;
    // Si había que cerrar una sesión vieja, el login espera a que termine.
    void logoutDone.then(() => {
      try {
        current.login();
      } catch (err) {
        console.error("No se pudo abrir el login de Privy:", err);
      }
    });
  }
}

/** Abre el login de Privy. Si el SDK aún carga, lo pide y lo abre al estar listo. */
export function privyLogin(): void {
  if (actions && state.ready) {
    actions.login();
    return;
  }
  pendingLogin = true;
  requestPrivyLayer();
}

/**
 * Cierra la sesión de Privy. Si Privy no está listo (o nunca se cargó, p. ej. en una
 * sesión de Freighter), la cierra en cuanto cargue: así una sesión de Privy que quedó
 * abierta no vuelve a meter al usuario solo al llegar a /login.
 */
export function privyLogout(): void {
  pendingLogin = false;
  if (actions && state.ready) {
    if (state.authenticated) void runLogout(actions);
    return;
  }
  pendingLogout = true;
}

/** Abre el panel de Privy para ver/exportar la wallet embebida. */
export async function privyExportWallet(address: string): Promise<void> {
  const current = await waitFor(
    () => (actions && state.ready ? actions : null),
    "Privy no está listo. Inténtalo de nuevo en unos segundos."
  );
  await current.exportWallet(address);
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
  // Una sesión que se está cerrando no debe volver a abrir la de la app.
  if (pendingLogout || loggingOut) return;
  connectListeners.forEach((cb) => {
    try { cb(wallet); } catch { /* un listener no debe romper a los demás */ }
  });
}
