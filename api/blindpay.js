// /api/blindpay?action=quote|payout|status — off-ramp USDC→SPEI (BlindPay sandbox).
// Consolidado en un solo Serverless Function para respetar el límite del plan Hobby (≤12).
//   POST /api/blindpay?action=quote   Body: { amount }                                → cotiza (no mueve fondos)
//   POST /api/blindpay?action=payout  Body: { amount, walletAddress, fundingTxHash }  → verifica el pago y dispara el payout
//   GET  /api/blindpay?action=status&id=po_…                                          → estado del payout
// Antes del payout, el usuario retira del vault y paga ese USDC a la cuenta de fondeo
// (`fundingAddress` en la respuesta del quote). El payout solo sale si ese pago se verifica.
import { createQuote, getPayout, summarizeQuote } from "./_blindpay-core.mjs";
import { fundingAddress, payoutWithFunding } from "./_offramp.mjs";
import { finishRampPayout } from "./_supabase.mjs";
import { createLogger } from "./_logger.mjs";
import {
  validateBody,
  validateQuery,
  blindpayPayoutBodySchema,
  blindpayQuoteBodySchema,
  blindpayStatusQuerySchema,
  reportValidationError,
} from "./validation.mjs";

const PAYOUT_HTTP_STATUS = {
  funding_not_found: 404,
  funding_failed: 400,
  funding_expired: 400,
  funding_invalid: 400,
  funding_insufficient: 400,
  funding_wrong_sender: 403,
  funding_already_used: 409,
};

const FINAL_STATUSES = new Set(["completed", "failed", "refunded"]);

// 503: falta configuración o Supabase. No salió ningún payout y se puede reintentar.
const UNAVAILABLE_CODES = new Set(["supabase_unavailable", "offramp_not_configured"]);
const failureStatus = (error) => (UNAVAILABLE_CODES.has(error.code) ? 503 : 502);

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
      if (FINAL_STATUSES.has(payout.status)) {
        // Deja a la vista los payouts fallidos o reembolsados, que necesitan devolver el USDC.
        await finishRampPayout(payout.id, payout.status).catch((error) =>
          log.error("blindpay_status.record_failed", { id, err: error.message })
        );
      }
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

  let body;
  try {
    body = validateBody(action === "payout" ? blindpayPayoutBodySchema : blindpayQuoteBodySchema, req.body || {});
  } catch (error) {
    return reportValidationError(res, error);
  }

  const bankAccountId = process.env.BLINDPAY_DEMO_BANK_ACCOUNT_ID;
  if (!bankAccountId) {
    log.error(`blindpay_${action}.misconfigured`, { reason: "BLINDPAY_DEMO_BANK_ACCOUNT_ID no configurado" });
    return res.status(500).json({ error: "BlindPay demo no configurado" });
  }

  const amountCents = Math.round(body.amount * 100);

  if (action === "quote") {
    try {
      const destination = fundingAddress();
      const quote = await createQuote({ amountCents, bankAccountId });
      const summary = summarizeQuote(quote);
      log.info("blindpay_quote.done", {
        quoteId: summary.quoteId,
        senderUsd: summary.senderUsd,
        receiverMxn: summary.receiverMxn,
      });
      return res.status(200).json({ ...summary, fundingAddress: destination });
    } catch (error) {
      log.error("blindpay_quote.error", { err: error.message, status: error.status });
      return res.status(failureStatus(error)).json({ error: error.message || "Error al cotizar con BlindPay" });
    }
  }

  // action === "payout"
  try {
    const result = await payoutWithFunding({
      walletAddress: body.walletAddress,
      amountCents,
      fundingTxHash: body.fundingTxHash,
      bankAccountId,
      log,
    });
    if (result.reason) {
      log.info("blindpay_payout.rejected", { reason: result.reason, fundingTxHash: body.fundingTxHash });
      return res.status(PAYOUT_HTTP_STATUS[result.reason] ?? 400).json({ reason: result.reason });
    }
    const { quote, payout } = result;
    const summary = summarizeQuote(quote);
    log.info("blindpay_payout.done", {
      payoutId: payout.id,
      status: payout.status,
      receiverMxn: summary.receiverMxn,
      fundingTxHash: body.fundingTxHash,
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
    return res.status(failureStatus(error)).json({ error: error.message || "Error al ejecutar el retiro a SPEI" });
  }
}
