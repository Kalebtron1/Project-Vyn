// POST /api/onramp-init — registra (o reutiliza) la blockchain wallet del usuario en el
// receiver compartido de BlindPay y guarda el mapping en Supabase. Idempotente por wallet.
// Body: { walletAddress (G…), email? }. Devuelve { receiverId, blockchainWalletId, reused }.
import { ensureBlockchainWallet } from "./_blindpay-onramp.mjs";
import { createLogger } from "./_logger.js";
import { validateBody, onrampInitBodySchema, reportValidationError } from "./validation.js";

export default async function handler(req, res) {
  const log = createLogger(req);
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  let body;
  try {
    body = validateBody(onrampInitBodySchema, req.body || {});
  } catch (error) {
    return reportValidationError(res, error);
  }

  try {
    const result = await ensureBlockchainWallet({
      walletAddress: body.walletAddress,
      email: body.email,
    });
    log.info("onramp_init.done", { ...result, walletAddress: body.walletAddress });
    return res.status(200).json(result);
  } catch (error) {
    log.error("onramp_init.error", { err: error.message, status: error.status });
    return res.status(502).json({ error: error.message || "Error al registrar la wallet en BlindPay" });
  }
}
