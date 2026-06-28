// Núcleo de BlindPay (off-ramp SPEI) — ÚNICA fuente de verdad, compartida por:
//   - api/blindpay-quote.js / blindpay-payout.js / blindpay-status.js  (Vercel serverless, ESM)
//   - backend/server.js                                                (Express local, CommonJS → await import())
//
// Modelo del off-ramp (ver memoria "blindpay-integration"):
//   La UI habla 100% en USDC; el USDB es un artefacto invisible de TESTNET. El payout
//   USDB→SPEI lo firma una WALLET DE PAYOUT del backend (BLINDPAY_PAYOUT_SECRET), nunca
//   el usuario. En testnet el token es USDB (USDC/USDT son de mainnet). En producción
//   esto sería USDC real end-to-end y desaparece la sustitución.
//
// Secuencia del payout en Stellar (verificada contra la API en sandbox):
//   POST /quotes → POST /payouts/stellar/authorize (devuelve XDR sin firmar en
//   `transaction_hash`) → se firma con la wallet de payout → POST /payouts/stellar.
//   El XDR trae timebounds atados a la expiración del quote, así que authorize→firma→
//   submit DEBE correr de corrido (este módulo lo hace en un solo paso).

import { TransactionBuilder, Keypair, Networks } from "@stellar/stellar-sdk";

const BASE_URL = process.env.BLINDPAY_BASE_URL || "https://api.blindpay.com/v1";

// Defaults de testnet/sandbox. En mainnet: network "stellar", token "USDC".
export const OFFRAMP_NETWORK = process.env.BLINDPAY_NETWORK || "stellar_testnet";
export const OFFRAMP_TOKEN = process.env.BLINDPAY_TOKEN || "USDB";

function getConfig() {
  const apiKey = process.env.BLINDPAY_API_KEY;
  const instanceId = process.env.BLINDPAY_INSTANCE_ID;
  if (!apiKey || !instanceId) {
    throw new Error("BlindPay no configurado: faltan BLINDPAY_API_KEY / BLINDPAY_INSTANCE_ID");
  }
  return { apiKey, instanceId };
}

async function bpFetch(path, { method = "GET", body } = {}) {
  const { apiKey } = getConfig();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const detail = data && (data.message || data.error || (Array.isArray(data.errors) && data.errors.join("; ")));
    const err = new Error(detail || `BlindPay respondió ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Crea un quote de off-ramp para el receiver/cuenta indicados.
// amountCents: monto del SENDER en centavos (1000 = 10.00). Mínimo 500 (= $5.00).
export async function createQuote({ amountCents, bankAccountId, coverFees = false }) {
  const { instanceId } = getConfig();
  if (!bankAccountId) throw new Error("createQuote: falta bankAccountId");
  if (!Number.isInteger(amountCents) || amountCents < 500) {
    throw new Error("createQuote: amountCents debe ser un entero >= 500 (=$5.00)");
  }
  // Comisión de plataforma (además de la de BlindPay) cuando está configurada.
  const partnerFeeId = process.env.BLINDPAY_PARTNER_FEE_ID || undefined;
  return bpFetch(`/instances/${instanceId}/quotes`, {
    method: "POST",
    body: {
      bank_account_id: bankAccountId,
      currency_type: "sender",
      request_amount: amountCents,
      network: OFFRAMP_NETWORK,
      token: OFFRAMP_TOKEN,
      cover_fees: coverFees,
      ...(partnerFeeId ? { partner_fee_id: partnerFeeId } : {}),
    },
  });
}

// Ejecuta el payout en Stellar para un quote ya creado: authorize → firma → submit.
// Corre de un tirón porque el XDR caduca con el quote. Devuelve el payout de BlindPay.
export async function executeStellarPayout({ quoteId }) {
  const { instanceId } = getConfig();
  const secret = process.env.BLINDPAY_PAYOUT_SECRET;
  if (!secret) throw new Error("executeStellarPayout: falta BLINDPAY_PAYOUT_SECRET");
  if (!quoteId) throw new Error("executeStellarPayout: falta quoteId");

  const kp = Keypair.fromSecret(secret);
  const sender = kp.publicKey();

  const auth = await bpFetch(`/instances/${instanceId}/payouts/stellar/authorize`, {
    method: "POST",
    body: { quote_id: quoteId, sender_wallet_address: sender },
  });
  // BlindPay devuelve el XDR sin firmar en `transaction_hash` (nombre heredado de su API).
  const unsignedXdr = auth?.transaction_hash;
  if (!unsignedXdr) throw new Error("authorize no devolvió XDR para firmar");

  const tx = TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET);
  tx.sign(kp);

  return bpFetch(`/instances/${instanceId}/payouts/stellar`, {
    method: "POST",
    body: {
      quote_id: quoteId,
      sender_wallet_address: sender,
      signed_transaction: tx.toXDR(),
    },
  });
}

// Quote + payout en un solo paso (evita expiración entre que el usuario confirma y se
// ejecuta): se cotiza FRESCO justo antes de mover fondos. Devuelve { quote, payout }.
export async function quoteAndPayout({ amountCents, bankAccountId, coverFees = false }) {
  const quote = await createQuote({ amountCents, bankAccountId, coverFees });
  const payout = await executeStellarPayout({ quoteId: quote.id });
  return { quote, payout };
}

export async function getPayout(payoutId) {
  const { instanceId } = getConfig();
  if (!payoutId) throw new Error("getPayout: falta payoutId");
  return bpFetch(`/instances/${instanceId}/payouts/${payoutId}`);
}

// Recorta un quote de BlindPay a lo que la UI necesita (sin el ABI/contract enorme).
// Montos USD/MXN vienen en centavos; las "quotation" son MXN/USD ×100.
export function summarizeQuote(q) {
  if (!q) return null;
  return {
    quoteId: q.id,
    senderUsd: q.sender_amount / 100,
    receiverMxn: q.receiver_amount / 100,
    flatFeeUsd: q.flat_fee / 100,
    partnerFeeUsd: (q.partner_fee_amount || 0) / 100,
    rateMxnPerUsd: q.blindpay_quotation / 100,
    commercialRateMxnPerUsd: q.commercial_quotation / 100,
    expiresAt: q.expires_at,
  };
}
