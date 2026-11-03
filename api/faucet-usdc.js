// POST /api/faucet-usdc — envía una pequeña cantidad de USDC (testnet) a la wallet del
// usuario para que pueda probar un depósito. Body: { address }. Requiere trustline USDC.
import { applyCors } from "./_cors.mjs";
import { clientIp, sendFaucetUsdc } from "./_faucet-core.mjs";
import { createLogger } from "./_logger.mjs";
import { requireSessionFor } from "./_session.mjs";

const REASON_HTTP_STATUS = { ip_cap: 429, global_cap: 429, in_review: 409 };

// 503: falta Supabase o configuración. No se movió dinero y se puede reintentar.
const UNAVAILABLE_CODES = new Set(["supabase_unavailable", "faucet_not_configured"]);

export default async function handler(req, res) {
  const log = createLogger(req);
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }
  const address = req.body && req.body.address;
  if (!address || !/^G[A-Z2-7]{55}$/.test(String(address))) {
    return res.status(400).json({ error: "address inválida (dirección Stellar G…)" });
  }
  if (!requireSessionFor(req, res, address)) return;
  try {
    const result = await sendFaucetUsdc({ to: address, ip: clientIp(req), log });
    log.info("faucet_usdc.done", { address, ...result });
    return res.status(REASON_HTTP_STATUS[result.reason] ?? 200).json(result);
  } catch (error) {
    log.error("faucet_usdc.error", { err: error.message });
    const status = UNAVAILABLE_CODES.has(error.code) ? 503 : 502;
    return res.status(status).json({ error: error.message || "Error enviando USDC" });
  }
}
