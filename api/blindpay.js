// /api/blindpay?action=quote|payout|status — off-ramp USDC→SPEI (BlindPay sandbox).
// Consolidado en un solo Serverless Function para respetar el límite del plan Hobby (≤12).
//   POST /api/blindpay?action=quote   Body: { amount }            → cotiza (no mueve fondos)
//   POST /api/blindpay?action=payout  Body: { amount }            → cotiza fresco + dispara payout
//   GET  /api/blindpay?action=status&id=po_…                      → estado del payout (polling)
// La pata on-chain de USDC del usuario (withdraw del vault) ocurre en el frontend ANTES del payout.
import { createQuote, quoteAndPayout, getPayout, summarizeQuote } from "./_blindpay-core.mjs";
import { createLogger } from "./_logger.mjs";
import {
  validateBody,
  validateQuery,
  blindpayQuoteBodySchema,
  blindpayStatusQuerySchema,
  reportValidationError,
} from "./validation.mjs";

const DEMO_BANK_ACCOUNT_ID = process.env.BLINDPAY_DEMO_BANK_ACCOUNT_ID;

export default async function handler(req, res) {
  const log = createLogger(req);
  const action = String(req.query?.action || "");

  if (action === "status") {
    if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });
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

  if (action !== "quote" && action !== "payout") {
    return res.status(400).json({ error: "action inválida (usa quote, payout o status)" });
  }
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
    log.error(`blindpay_${action}.misconfigured`, { reason: "BLINDPAY_DEMO_BANK_ACCOUNT_ID no configurado" });
    return res.status(500).json({ error: "BlindPay demo no configurado" });
  }

  const amountCents = Math.round(amount * 100);

  if (action === "quote") {
    try {
      const quote = await createQuote({ amountCents, bankAccountId: DEMO_BANK_ACCOUNT_ID });
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

  // action === "payout"
  try {
    const { quote, payout } = await quoteAndPayout({ amountCents, bankAccountId: DEMO_BANK_ACCOUNT_ID });
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
