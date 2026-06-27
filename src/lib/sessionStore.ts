/**
 * sessionStore — almacenamiento durable para la sesión de wallet.
 *
 * En móvil el `localStorage` puede comportarse de forma poco fiable (modos de
 * privacidad, navegadores in-app, límites de almacenamiento). Para que la sesión
 * sobreviva a recargas y a reabrir el navegador, espejamos cada valor también en
 * una cookie de larga duración y, al leer, caemos a la cookie si `localStorage`
 * está vacío (rehidratándolo). Todos los accesos van envueltos en try/catch para
 * no romper si el almacenamiento está bloqueado.
 */

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 días

function readCookie(key: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${encodeURIComponent(key)}=`;
  const found = document.cookie
    .split("; ")
    .find((c) => c.startsWith(prefix));
  if (!found) return null;
  return decodeURIComponent(found.slice(prefix.length));
}

function writeCookie(key: string, value: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(
    value
  )}; max-age=${COOKIE_MAX_AGE}; path=/; SameSite=Lax`;
}

function deleteCookie(key: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${encodeURIComponent(key)}=; max-age=0; path=/; SameSite=Lax`;
}

export function getItem(key: string): string | null {
  try {
    const ls = localStorage.getItem(key);
    if (ls !== null) return ls;
  } catch {
    /* localStorage bloqueado: seguimos con la cookie */
  }
  const cookie = readCookie(key);
  if (cookie !== null) {
    // Rehidratar localStorage para que el resto de la sesión sea consistente.
    try {
      localStorage.setItem(key, cookie);
    } catch {
      /* ignore */
    }
    return cookie;
  }
  return null;
}

export function setItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
  writeCookie(key, value);
}

export function removeItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  deleteCookie(key);
}
