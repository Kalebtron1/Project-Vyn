// /api/onramp?action=init|quote|payin|status — on-ramp SPEI→USDB (BlindPay sandbox).
// Consolidado en un solo Serverless Function para respetar el límite del plan Hobby (≤12).
//   POST /api/onramp?action=init    Body: { walletAddress, email? }            → registra wallet (idempotente)
//   POST /api/onramp?action=quote   Body: { walletAddress, amountMxn, email? } → cotiza (no genera CLABE)
//   POST /api/onramp?action=payin   Body: { walletAddress, amountMxn, email? } → cotiza fresco + genera CLABE
//   GET  /api/onramp?action=status&id=pi_…                                      → estado del payin (polling)
import {
  ensureBlockchainWallet,
  createPayinQuote,
  quoteAndPayin,
  getPayin,
  summarizePayinQuote,
  summarizePayin,
} from "./_blindpay-onramp.mjs";
import { createLogger } from "./_logger.mjs";
import {
  validateBody,
  validateQuery,
  onrampInitBodySchema,
  onrampQuoteBodySchema,
  onrampStatusQuerySchema,
  reportValidationError,
} from "./validation.mjs";

export default async function handler(req, res) {
  const log = createLogger(req);
  const action = String(req.query?.action || "");

  if (action === "status") {
    if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });
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

  if (action !== "init" && action !== "quote" && action !== "payin") {
    return res.status(400).json({ error: "action inválida (usa init, quote, payin o status)" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  if (action === "init") {
    let body;
    try {
      body = validateBody(onrampInitBodySchema, req.body || {});
    } catch (error) {
      return reportValidationError(res, error);
    }
    try {
      const result = await ensureBlockchainWallet({ walletAddress: body.walletAddress, email: body.email });
      log.info("onramp_init.done", { ...result, walletAddress: body.walletAddress });
      return res.status(200).json(result);
    } catch (error) {
      log.error("onramp_init.error", { err: error.message, status: error.status });
      return res.status(502).json({ error: error.message || "Error al registrar la wallet en BlindPay" });
    }
  }

  // action === "quote" | "payin": ambos validan el mismo body y aseguran la wallet primero.
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
    const amountCents = Math.round(body.amountMxn * 100);

    if (action === "quote") {
      const quote = await createPayinQuote({ blockchainWalletId, amountCents });
      const summary = summarizePayinQuote(quote);
      log.info("onramp_quote.done", {
        quoteId: summary.quoteId,
        senderMxn: summary.senderMxn,
        receiverUsd: summary.receiverUsd,
      });
      return res.status(200).json(summary);
    }

    // action === "payin"
    const { quote, payin } = await quoteAndPayin({ blockchainWalletId, amountCents });
    const summary = summarizePayin(payin);
    log.info("onramp_payin.done", { payinId: summary.payinId, status: summary.status, clabe: summary.clabe });
    return res.status(200).json({ ...summary, quote: summarizePayinQuote(quote) });
  } catch (error) {
    log.error(`onramp_${action}.error`, { err: error.message, status: error.status });
    const msg = action === "quote" ? "Error al cotizar el depósito SPEI" : "Error al generar el depósito SPEI";
    return res.status(502).json({ error: error.message || msg });
  }
}
