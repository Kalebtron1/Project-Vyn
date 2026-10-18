import crypto from "crypto";
import { createLogger } from "./_logger.mjs";
import { storeAuthNonce, consumeAuthNonce } from "./_supabase.mjs";

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function generateNonce() {
  return crypto.randomBytes(16).toString("hex");
}

export default async function handler(req, res) {
  const log = createLogger(req);

  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { address } = req.body || {};
  if (!address) return res.status(400).json({ error: "address required" });

  const nonce = generateNonce();
  const expires = Date.now() + NONCE_TTL_MS;

  try {
    await storeAuthNonce(address, nonce, expires);
    log.info("nonce.issued", { address, expires });
    return res.status(200).json({ success: true, nonce, expires });
  } catch (error) {
    log.error("nonce.store_error", { address, err: error.message });
    return res.status(503).json({
      error: "No se pudo persistir el nonce de autenticación",
    });
  }
}

// Helper for other modules — consumes a nonce atomically (single-use)
export async function consumeNonce(address, nonce) {
  return consumeAuthNonce(address, nonce);
}
