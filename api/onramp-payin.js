// POST /api/onramp-payin — genera la CLABE para depositar por SPEI. Cotiza FRESCO y inicia
// el payin de un tirón (el quote caduca en 5 min). Body: { walletAddress (G…), amountMxn, email? }.
// Devuelve { payinId, status, clabe, summary }. En dev BlindPay auto-acredita ~30s después.
import { ensureBlockchainWallet, quoteAndPayin, summarizePayinQuote, summarizePayin } from "./_blindpay-onramp.mjs";
import { createLogger } from "./_logger.js";
import { validateBody, onrampQuoteBodySchema, reportValidationError } from "./validation.js";

export default async function handler(req, res) {
  const log = createLogger(req);
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  let body;
  try {
    body = validateBody(onrampQuoteBodySchema, req.body || {});
  } catch (error) {
    return reportValidationError(res, error);
  }

  try {
    const { blockchainWalletId } = await ensureBlockchainWallet({
      walletAddress: body.walletAddress,
      email: body.email,
    });
    const { quote, payin } = await quoteAndPayin({
      blockchainWalletId,
      amountCents: Math.round(body.amountMxn * 100),
    });
    const summary = summarizePayin(payin);
    log.info("onramp_payin.done", { payinId: summary.payinId, status: summary.status, clabe: summary.clabe });
    return res.status(200).json({ ...summary, quote: summarizePayinQuote(quote) });
  } catch (error) {
    log.error("onramp_payin.error", { err: error.message, status: error.status });
    return res.status(502).json({ error: error.message || "Error al generar el depósito SPEI" });
  }
}
