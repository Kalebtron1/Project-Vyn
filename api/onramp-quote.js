// POST /api/onramp-quote — cotiza un depósito SPEI (on-ramp) para mostrarlo en la UI.
// Body: { walletAddress (G…), amountMxn, email? }. No genera CLABE ni mueve fondos.
import { ensureBlockchainWallet, createPayinQuote, summarizePayinQuote } from "./_blindpay-onramp.mjs";
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
    const quote = await createPayinQuote({
      blockchainWalletId,
      amountCents: Math.round(body.amountMxn * 100),
    });
    const summary = summarizePayinQuote(quote);
    log.info("onramp_quote.done", { quoteId: summary.quoteId, senderMxn: summary.senderMxn, receiverUsd: summary.receiverUsd });
    return res.status(200).json(summary);
  } catch (error) {
    log.error("onramp_quote.error", { err: error.message, status: error.status });
    return res.status(502).json({ error: error.message || "Error al cotizar el depósito SPEI" });
  }
}
