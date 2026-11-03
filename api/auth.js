// /api/auth?action=challenge|verify|session|logout — sesión de wallet (reemplaza a nonce.js).
//   POST /api/auth?action=challenge  Body: { address }      → { transaction, networkPassphrase }
//   POST /api/auth?action=verify     Body: { transaction }  → cookie de sesión + { address, expiresAt }
//   GET  /api/auth?action=session                           → { address, expiresAt } o 401
//   POST /api/auth?action=logout                            → borra la cookie
// Ver api/_session.mjs.
import { createLogger } from "./_logger.mjs";
import {
  AuthError,
  clearSessionCookie,
  createChallenge,
  getSession,
  issueSessionToken,
  NETWORK_PASSPHRASE,
  setSessionCookie,
  verifyChallenge,
} from "./_session.mjs";

// 503: falta configuración o Supabase. Se puede reintentar.
const UNAVAILABLE_CODES = new Set(["auth_not_configured", "supabase_unavailable"]);

function sendError(res, log, event, error) {
  if (error instanceof AuthError) {
    log.info(event, { reason: error.message });
    return res.status(401).json({ error: error.message, reason: "invalid_challenge" });
  }
  log.error(event, { err: error.message });
  const status = UNAVAILABLE_CODES.has(error.code) ? 503 : 500;
  return res.status(status).json({ error: error.message || "Error de sesión" });
}

export default async function handler(req, res) {
  const log = createLogger(req);
  const action = String(req.query?.action || "");

  if (action === "session") {
    if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });
    try {
      const session = getSession(req);
      if (!session) return res.status(401).json({ error: "Sin sesión", reason: "no_session" });
      return res.status(200).json(session);
    } catch (error) {
      return sendError(res, log, "auth_session.error", error);
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  if (action === "logout") {
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  }

  if (action === "challenge") {
    try {
      const transaction = createChallenge(String(req.body?.address || ""));
      return res.status(200).json({ transaction, networkPassphrase: NETWORK_PASSPHRASE });
    } catch (error) {
      if (error instanceof AuthError) return res.status(400).json({ error: error.message });
      return sendError(res, log, "auth_challenge.error", error);
    }
  }

  if (action === "verify") {
    const transaction = req.body?.transaction;
    if (!transaction || typeof transaction !== "string") {
      return res.status(400).json({ error: "transaction requerida" });
    }
    try {
      const address = await verifyChallenge(transaction);
      const { token, expiresAt } = issueSessionToken(address);
      setSessionCookie(res, token);
      log.info("auth_verify.done", { address });
      return res.status(200).json({ address, expiresAt });
    } catch (error) {
      return sendError(res, log, "auth_verify.rejected", error);
    }
  }

  return res.status(400).json({ error: "action inválida (usa challenge, verify, session o logout)" });
}
