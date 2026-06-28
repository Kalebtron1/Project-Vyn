// GET /api/onramp-status?id=pi_… — estado de un payin (respaldo del webhook). Devuelve el
// resumen del payin, incluido el hash on-chain del USDB acreditado cuando completa.
import { getPayin, summarizePayin } from "./_blindpay-onramp.mjs";
import { createLogger } from "./_logger.js";
import { validateQuery, onrampStatusQuerySchema, reportValidationError } from "./validation.js";

export default async function handler(req, res) {
  const log = createLogger(req);
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  let query;
  try {
    query = validateQuery(onrampStatusQuerySchema, req.query || {});
  } catch (error) {
    return reportValidationError(res, error);
  }

  try {
    const payin = await getPayin(query.id);
    const summary = summarizePayin(payin);
    log.info("onramp_status.done", { payinId: summary.payinId, status: summary.status });
    return res.status(200).json(summary);
  } catch (error) {
    log.error("onramp_status.error", { err: error.message, status: error.status });
    return res.status(502).json({ error: error.message || "Error al consultar el depósito" });
  }
}
