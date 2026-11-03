/**
 * Sesión de la API (cookie HttpOnly emitida por /api/auth). Prueba ante el backend que el
 * usuario controla su wallet: el servidor manda un desafío (transacción tipo SEP-10 que
 * nunca se envía a la red), la wallet lo firma y el servidor devuelve la cookie.
 *
 * Se pide justo antes de una acción que la necesita, no al entrar: así nadie ve un popup
 * de firma solo por abrir la app. La firma llega como parámetro (`useMobileWallet().sign`),
 * que ya sabe firmar con el kit o con Privy; este módulo no importa ninguno de los dos.
 */

type SignFn = (xdr: string) => Promise<
  { ok: true; signedXdr: string } | { ok: false; cancelled: boolean; error: string }
>;

export type ApiSessionResult = { ok: true } | { ok: false; cancelled: boolean; error: string };

// Última sesión confirmada en esta pestaña. La cookie es HttpOnly: no se puede leer.
let known: { address: string; expiresAt: number } | null = null;

// Margen para no usar una sesión a punto de vencer.
const EXPIRY_MARGIN_MS = 60_000;

const isValid = (address: string) => known?.address === address && known.expiresAt - EXPIRY_MARGIN_MS > Date.now();

async function readSession(address: string): Promise<boolean> {
  const r = await fetch("/api/auth?action=session", { credentials: "same-origin" });
  if (!r.ok) return false;
  const data = await r.json().catch(() => null);
  if (data?.address !== address) return false;
  known = { address, expiresAt: Date.parse(data.expiresAt) };
  return isValid(address);
}

/** Asegura una sesión de la API para `address`, pidiendo la firma solo si hace falta. */
export async function ensureApiSession(address: string, sign: SignFn): Promise<ApiSessionResult> {
  try {
    if (isValid(address) || (await readSession(address))) return { ok: true };

    const challenge = await fetch("/api/auth?action=challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
    const { transaction, error } = await challenge.json().catch(() => ({}));
    if (!challenge.ok || !transaction) return { ok: false, cancelled: false, error: error || "" };

    const signed = await sign(transaction);
    // `in` estrecha la unión: este proyecto compila sin strictNullChecks.
    if (!("signedXdr" in signed)) return signed;

    const verify = await fetch("/api/auth?action=verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ transaction: signed.signedXdr }),
    });
    const data = await verify.json().catch(() => ({}));
    if (!verify.ok || data.address !== address) return { ok: false, cancelled: false, error: data.error || "" };
    known = { address, expiresAt: Date.parse(data.expiresAt) };
    return { ok: true };
  } catch (e) {
    return { ok: false, cancelled: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Cierra la sesión de la API (al cerrar la de la wallet). */
export function clearApiSession(): void {
  known = null;
  void fetch("/api/auth?action=logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
}
