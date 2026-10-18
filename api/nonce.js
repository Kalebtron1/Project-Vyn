import crypto from "crypto";
import { applyCors } from "./_logger.mjs";

// Simple store en memoria de nonces: address -> { nonce, expires }
const nonces = new Map();

function generateNonce() {
  return crypto.randomBytes(16).toString("hex");
}

export default function handler(req, res) {
  if (applyCors(req, res, { methods: "POST,OPTIONS", headers: "Content-Type" })) {
    return;
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { address } = req.body || {};
  if (!address) return res.status(400).json({ error: 'address required' });

  const nonce = generateNonce();
  const expires = Date.now() + 5 * 60 * 1000; // 5 minutes
  nonces.set(address, { nonce, expires });

  return res.json({ success: true, nonce, expires });
}

// Helper for other modules
export function consumeNonce(address, nonce) {
  const entry = nonces.get(address);
  if (!entry) return false;
  if (entry.expires < Date.now()) {
    nonces.delete(address);
    return false;
  }
  if (entry.nonce !== nonce) return false;
  nonces.delete(address);
  return true;
}
