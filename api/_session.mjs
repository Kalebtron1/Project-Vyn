// Sesión de wallet (#89, #90). Desafío tipo SEP-10: el servidor arma y firma una transacción
// que nunca se envía a la red (secuencia 0, manageData con un valor aleatorio, 5 min de
// vigencia). La wallet del usuario la firma, y el servidor comprueba las dos firmas, la
// vigencia y que el desafío no se haya usado antes. Toda wallet sabe firmar transacciones,
// incluida la de Privy, así que no depende de `signMessage`.
//
// La sesión es un JWT (HS256) en una cookie HttpOnly. No hay que guardar nonces: la firma
// del servidor y la vigencia hacen válido el desafío, y Supabase solo recuerda los ya usados.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Keypair, Networks, WebAuth } from "@stellar/stellar-sdk";
import { consumeAuthChallenge } from "./_supabase.mjs";

export const NETWORK_PASSPHRASE = Networks.TESTNET;
const CHALLENGE_TTL_SECONDS = 300;
// `readChallengeTx` acepta 5 min de margen sobre la vigencia; el desafío usado se recuerda
// hasta que ese margen también termine.
const CHALLENGE_GRACE_SECONDS = 300;
export const SESSION_TTL_SECONDS = 60 * 60;
export const SESSION_COOKIE = "vyn_session";

function notConfigured(message) {
  const err = new Error(message);
  err.code = "auth_not_configured";
  return err;
}

/** Rechazo del desafío o de la sesión: siempre se responde 401. */
export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
  }
}

function signingKeypair() {
  try {
    return Keypair.fromSecret(process.env.AUTH_SIGNING_SECRET || "");
  } catch {
    throw notConfigured("Sesión no configurada: falta AUTH_SIGNING_SECRET");
  }
}

function jwtSecret() {
  const secret = process.env.AUTH_JWT_SECRET || "";
  if (secret.length < 32) throw notConfigured("Sesión no configurada: AUTH_JWT_SECRET debe tener 32 caracteres o más");
  return secret;
}

// Etiqueta del desafío. Firmar y verificar en el mismo despliegue usa el mismo valor.
function authDomain() {
  return process.env.AUTH_HOME_DOMAIN || process.env.VERCEL_PROJECT_PRODUCTION_URL || "localhost";
}

/** XDR del desafío, ya firmado por el servidor, para que lo firme `address`. */
export function createChallenge(address) {
  if (!/^G[A-Z2-7]{55}$/.test(address || "")) throw new AuthError("Dirección Stellar inválida");
  const domain = authDomain();
  return WebAuth.buildChallengeTx(
    signingKeypair(),
    address,
    domain,
    CHALLENGE_TTL_SECONDS,
    NETWORK_PASSPHRASE,
    domain
  );
}

/** Verifica el desafío firmado por el usuario y lo marca como usado. Devuelve su dirección. */
export async function verifyChallenge(signedXdr) {
  const serverAccount = signingKeypair().publicKey();
  const domain = authDomain();
  let clientAccountID;
  let maxTime;
  let challengeHash;
  try {
    const challenge = WebAuth.readChallengeTx(signedXdr, serverAccount, NETWORK_PASSPHRASE, domain, domain);
    clientAccountID = challenge.clientAccountID;
    maxTime = Number(challenge.tx.timeBounds.maxTime);
    // El hash no cambia con las firmas: agregar o quitar una no vuelve "nuevo" el desafío.
    challengeHash = challenge.tx.hash().toString("hex");
    if (!clientAccountID.startsWith("G")) throw new Error("Solo se aceptan cuentas G…");
    // Firma de la llave maestra de la cuenta: funciona aunque la cuenta aún no exista on-chain.
    WebAuth.verifyChallengeTxSigners(signedXdr, serverAccount, NETWORK_PASSPHRASE, [clientAccountID], domain, domain);
  } catch (error) {
    throw new AuthError(error?.message || "Desafío inválido");
  }
  if (Math.floor(Date.now() / 1000) > maxTime) throw new AuthError("El desafío venció");

  const expiresAt = new Date((maxTime + CHALLENGE_GRACE_SECONDS) * 1000).toISOString();
  if (!(await consumeAuthChallenge(challengeHash, expiresAt))) {
    throw new AuthError("El desafío ya se usó");
  }
  return clientAccountID;
}

// ── JWT HS256 ───────────────────────────────────────────────────────────────

const b64url = (value) => Buffer.from(value).toString("base64url");

export function issueSessionToken(address, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ sub: address, iat, exp: iat + SESSION_TTL_SECONDS, jti: randomUUID() }));
  const signature = createHmac("sha256", jwtSecret()).update(`${header}.${payload}`).digest("base64url");
  return { token: `${header}.${payload}.${signature}`, expiresAt: new Date((iat + SESSION_TTL_SECONDS) * 1000).toISOString() };
}

/** Devuelve { address, expiresAt } si el token es válido y vigente, o null. */
export function readSessionToken(token, now = Date.now()) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = createHmac("sha256", jwtSecret()).update(`${header}.${payload}`).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { alg } = JSON.parse(Buffer.from(header, "base64url").toString());
    const { sub, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (alg !== "HS256" || !/^G[A-Z2-7]{55}$/.test(sub) || !(exp * 1000 > now)) return null;
    return { address: sub, expiresAt: new Date(exp * 1000).toISOString() };
  } catch {
    return null;
  }
}

// ── Cookie ──────────────────────────────────────────────────────────────────

function cookieValue(req, name) {
  const header = req?.headers?.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`
  );
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

/** Sesión de la petición, o null. Lanza si falta AUTH_JWT_SECRET. */
export function getSession(req) {
  return readSessionToken(cookieValue(req, SESSION_COOKIE));
}

/**
 * Exige una sesión. Devuelve su dirección, o responde 401 (sin sesión) o 503 (sin
 * configuración) y devuelve null.
 */
export function requireSession(req, res) {
  let session;
  try {
    session = getSession(req);
  } catch (error) {
    res.status(503).json({ error: error.message, reason: "auth_not_configured" });
    return null;
  }
  if (!session) {
    res.status(401).json({ error: "Inicia sesión con tu wallet", reason: "no_session" });
    return null;
  }
  return session.address;
}

/**
 * Exige una sesión de `address`. Devuelve true si la hay; si no, responde 401, 403 (la
 * sesión es de otra wallet) o 503, y devuelve false.
 */
export function requireSessionFor(req, res, address) {
  const sessionAddress = requireSession(req, res);
  if (!sessionAddress) return false;
  if (sessionAddress !== address) {
    res.status(403).json({ error: "La sesión es de otra wallet", reason: "address_mismatch" });
    return false;
  }
  return true;
}
