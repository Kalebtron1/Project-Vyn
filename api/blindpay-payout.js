// POST /api/blindpay-payout — ejecuta el off-ramp: cotiza FRESCO y dispara el payout
// USDB→SPEI con la wallet de payout del backend (el usuario nunca firma esta pata).
// Body: { amount } en USDC. Usa el receiver/cuenta SPEI demo (sandbox).
//
// La pata on-chain de USDC del usuario (withdraw del vault) ocurre en el frontend ANTES
// de llamar aquí; este endpoint solo cubre la pata USDB→fiat (ver _blindpay-core.mjs).
import { quoteAndPayout, summarizeQuote } from "./_blindpay-core.mjs";
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
    log.error("blindpay_payout.misconfigured", { reason: "BLINDPAY_DEMO_BANK_ACCOUNT_ID no configurado" });
    return res.status(500).json({ error: "BlindPay demo no configurado" });
  }

  try {
    const { quote, payout } = await quoteAndPayout({
      amountCents: Math.round(amount * 100),
      bankAccountId: DEMO_BANK_ACCOUNT_ID,
    });
    const summary = summarizeQuote(quote);
    log.info("blindpay_payout.done", {
      payoutId: payout.id,
      status: payout.status,
      receiverMxn: summary.receiverMxn,
    });
    return res.status(200).json({
      payoutId: payout.id,
      status: payout.status,
      quote: summary,
      tracking: payout.tracking_complete || payout.tracking_transaction || null,
      payment: payout.tracking_payment || null,
    });
  } catch (error) {
    log.error("blindpay_payout.error", { err: error.message, status: error.status });
    return res.status(502).json({ error: error.message || "Error al ejecutar el retiro a SPEI" });
  }
}
