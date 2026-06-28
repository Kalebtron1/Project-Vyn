// POST /api/blindpay-quote — cotiza un retiro a SPEI (off-ramp) para mostrarlo en la UI.
// Body: { amount } en USDC. Usa el receiver/cuenta SPEI demo (sandbox). No mueve fondos.
import { createQuote, summarizeQuote } from "./_blindpay-core.mjs";
import { createLogger } from "./_logger.js";
import { validateBody, blindpayQuoteBodySchema, reportValidationError } from "./validation.js";

const DEMO_BANK_ACCOUNT_ID = process.env.BLINDPAY_DEMO_BANK_ACCOUNT_ID;

export default async function handler(req, res) {
  const log = createLogger(req);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  let amount;
  try {
    ({ amount } = validateBody(blindpayQuoteBodySchema, req.body || {}));
  } catch (error) {
    return reportValidationError(res, error);
  }

  if (!DEMO_BANK_ACCOUNT_ID) {
    log.error("blindpay_quote.misconfigured", { reason: "BLINDPAY_DEMO_BANK_ACCOUNT_ID no configurado" });
    return res.status(500).json({ error: "BlindPay demo no configurado" });
  }

  try {
    const quote = await createQuote({
      amountCents: Math.round(amount * 100),
      bankAccountId: DEMO_BANK_ACCOUNT_ID,
    });
    const summary = summarizeQuote(quote);
    log.info("blindpay_quote.done", {
      quoteId: summary.quoteId,
      senderUsd: summary.senderUsd,
      receiverMxn: summary.receiverMxn,
    });
    return res.status(200).json(summary);
  } catch (error) {
    log.error("blindpay_quote.error", { err: error.message, status: error.status });
    return res.status(502).json({ error: error.message || "Error al cotizar con BlindPay" });
  }
}
