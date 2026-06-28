// GET /api/blindpay-status?id=po_xxx — estado de un payout (polling de respaldo del webhook).
import { getPayout } from "./_blindpay-core.mjs";
import { createLogger } from "./_logger.js";
import { validateQuery, blindpayStatusQuerySchema, reportValidationError } from "./validation.js";

export default async function handler(req, res) {
  const log = createLogger(req);

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  let id;
  try {
    ({ id } = validateQuery(blindpayStatusQuerySchema, req.query || {}));
  } catch (error) {
    return reportValidationError(res, error);
  }

  try {
    const payout = await getPayout(id);
    return res.status(200).json({
      payoutId: payout.id,
      status: payout.status,
      tracking: payout.tracking_complete || payout.tracking_transaction || null,
      payment: payout.tracking_payment || null,
    });
  } catch (error) {
    log.error("blindpay_status.error", { id, err: error.message, status: error.status });
    return res.status(502).json({ error: error.message || "Error al consultar el payout" });
  }
}
