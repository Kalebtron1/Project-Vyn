// /api/blindpay?action=quote|payout|status — off-ramp USDC→SPEI (BlindPay sandbox).
// Consolidado en un solo Serverless Function para respetar el límite del plan Hobby (≤12).
//   POST /api/blindpay?action=quote   Body: { amount }                                           → cotiza (no mueve fondos)
//   POST /api/blindpay?action=payout  Body: { amount, walletAddress, withdrawalTxHash }          → verifica retiro on-chain + cotiza + dispara payout
//   GET  /api/blindpay?action=status&id=po_…                                                     → estado del payout (polling)
import {
  createQuote,
  quoteAndPayout,
  getPayout,
  summarizeQuote,
  verifyVaultWithdrawalTx,
} from "./_blindpay-core.mjs";
import {
  reservePayoutWithdrawalTx,
  recordPayoutWithdrawalTx,
  releasePayoutWithdrawalTx,
} from "./_supabase.mjs";
import { createLogger } from "./_logger.mjs";
import {
  validateBody,
  validateQuery,
  blindpayQuoteBodySchema,
  blindpayPayoutBodySchema,
  blindpayStatusQuerySchema,
  reportValidationError,
} from "./validation.mjs";

export default async function handler(req, res) {
  const log = createLogger(req);
  const action = String(req.query?.action || "");
  const demoBankAccountId = process.env.BLINDPAY_DEMO_BANK_ACCOUNT_ID;

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

  if (action === "quote") {
    let amount;
    try {
      ({ amount } = validateBody(blindpayQuoteBodySchema, req.body || {}));
    } catch (error) {
      return reportValidationError(res, error);
    }

    if (!demoBankAccountId) {
      log.error("blindpay_quote.misconfigured", {
        reason: "BLINDPAY_DEMO_BANK_ACCOUNT_ID no configurado",
      });
      return res.status(500).json({ error: "BlindPay demo no configurado" });
    }

    const amountCents = Math.round(amount * 100);
    try {
      const quote = await createQuote({ amountCents, bankAccountId: demoBankAccountId });
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
  let amount;
  let walletAddress;
  let withdrawalTxHash;
  try {
    ({ amount, walletAddress, withdrawalTxHash } = validateBody(
      blindpayPayoutBodySchema,
      req.body || {}
    ));
  } catch (error) {
    return reportValidationError(res, error);
  }

  if (!demoBankAccountId) {
    log.error("blindpay_payout.misconfigured", {
      reason: "BLINDPAY_DEMO_BANK_ACCOUNT_ID no configurado",
    });
    return res.status(500).json({ error: "BlindPay demo no configurado" });
  }

  // 1. Verificar on-chain que la transacción de retiro del vault sea válida, exitosa y cubra el monto.
  try {
    await verifyVaultWithdrawalTx({
      txHash: withdrawalTxHash,
      walletAddress,
      amountUsd: amount,
    });
  } catch (verifyError) {
    log.warn("blindpay_payout.invalid_withdrawal_tx", {
      walletAddress,
      withdrawalTxHash,
      err: verifyError.message,
    });
    return res.status(400).json({
      error: verifyError.message || "No se pudo verificar el retiro on-chain",
    });
  }

  // 2. Reservar atómicamente el hash de retiro para impedir que financie más de un payout.
  let reservation;
  try {
    reservation = await reservePayoutWithdrawalTx(withdrawalTxHash, {
      walletAddress,
      amountUsd: amount,
    });
  } catch (storeError) {
    log.error("blindpay_payout.dedup_error", {
      walletAddress,
      withdrawalTxHash,
      err: storeError.message,
    });
    return res.status(503).json({
      error: "No se pudo registrar la verificación del retiro. Intenta nuevamente.",
    });
  }

  if (!reservation.reserved) {
    log.warn("blindpay_payout.reused_tx_hash", { walletAddress, withdrawalTxHash });
    return res.status(409).json({
      error: "Esta transacción de retiro ya fue utilizada para un payout",
    });
  }

  const amountCents = Math.round(amount * 100);

  try {
    const { quote, payout } = await quoteAndPayout({
      amountCents,
      bankAccountId: demoBankAccountId,
    });
    await recordPayoutWithdrawalTx(withdrawalTxHash, { payoutId: payout.id });
    const summary = summarizeQuote(quote);
    log.info("blindpay_payout.done", {
      payoutId: payout.id,
      status: payout.status,
      walletAddress,
      withdrawalTxHash,
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
    await releasePayoutWithdrawalTx(withdrawalTxHash).catch(() => {});
    log.error("blindpay_payout.error", {
      walletAddress,
      withdrawalTxHash,
      err: error.message,
      status: error.status,
    });
    return res.status(502).json({ error: error.message || "Error al ejecutar el retiro a SPEI" });
  }
}
