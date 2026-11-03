// Off-ramp con fondeo verificado (#91). Antes del payout, el usuario paga USDC (pago clásico)
// a la cuenta de fondeo del off-ramp y manda el hash. El backend confirma en Horizon que ese
// pago existe, es reciente, viene de su wallet y cubre el monto; cada hash sirve una sola vez.
//
//   verified ─▶ submitted (BlindPay aceptó el payout) ─▶ completed | failed | refunded
//          └──▶ failed (BlindPay rechazó o no respondió)
//
// Una fila en `failed` o `refunded` significa que Vyn tiene el USDC del usuario y no pagó el
// SPEI: se le devuelve a mano desde la cuenta de fondeo.

import { quoteAndPayout } from "./_blindpay-core.mjs";
import { insertRampPayout, updateRampPayout } from "./_supabase.mjs";
import { HORIZON_URL, USDC } from "./_usdc.mjs";

const MAX_FUNDING_AGE_MS = 15 * 60 * 1000;

function notConfigured(message) {
  const err = new Error(message);
  err.code = "offramp_not_configured";
  return err;
}

/** Cuenta que recibe el USDC del usuario. Necesita trustline a USDC. */
export function fundingAddress() {
  const address = process.env.OFFRAMP_FUNDING_ADDRESS;
  if (!address || !/^G[A-Z2-7]{55}$/.test(address)) {
    throw notConfigured("Retiro SPEI no configurado: falta OFFRAMP_FUNDING_ADDRESS");
  }
  return address;
}

// "25.5000000" → 255000000n stroops. Horizon siempre manda 7 decimales.
function toStroops(amount) {
  const [whole, fraction = ""] = String(amount).split(".");
  return BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, "0").slice(0, 7));
}

async function horizonJson(path) {
  const res = await fetch(`${HORIZON_URL}${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Horizon respondió ${res.status}`);
  return res.json();
}

/**
 * Comprueba el pago de fondeo. Devuelve null si es válido, o el motivo del rechazo:
 * "funding_not_found" | "funding_failed" | "funding_expired" | "funding_invalid" |
 * "funding_wrong_sender" | "funding_insufficient".
 */
export async function checkFundingPayment({ txHash, walletAddress, amountCents, destination, now = Date.now() }) {
  const tx = await horizonJson(`/transactions/${txHash}`);
  if (!tx) return "funding_not_found";
  if (tx.successful !== true) return "funding_failed";
  if (now - Date.parse(tx.created_at) > MAX_FUNDING_AGE_MS) return "funding_expired";

  // Una sola operación: un pago de USDC del proyecto a la cuenta de fondeo.
  const ops = await horizonJson(`/transactions/${txHash}/operations?limit=2`);
  const records = ops?._embedded?.records || [];
  const [op] = records;
  if (
    records.length !== 1 ||
    op.type !== "payment" ||
    op.asset_code !== USDC.getCode() ||
    op.asset_issuer !== USDC.getIssuer() ||
    op.to !== destination
  ) {
    return "funding_invalid";
  }
  if (op.from !== walletAddress) return "funding_wrong_sender";
  if (toStroops(op.amount) < BigInt(amountCents) * 100_000n) return "funding_insufficient";
  return null;
}

/**
 * Verifica el fondeo, lo registra (un hash, un payout) y ejecuta el payout de BlindPay.
 * Devuelve { payoutId, status, quote, payout } o { reason }.
 */
export async function payoutWithFunding({ walletAddress, amountCents, fundingTxHash, bankAccountId, log }) {
  const destination = fundingAddress();
  const rejection = await checkFundingPayment({
    txHash: fundingTxHash,
    walletAddress,
    amountCents,
    destination,
  });
  if (rejection) return { reason: rejection };

  const rowId = await insertRampPayout({
    wallet_address: walletAddress,
    funding_tx_hash: fundingTxHash,
    amount_usd_cents: amountCents,
  });
  if (!rowId) return { reason: "funding_already_used" };

  let quote;
  let payout;
  try {
    ({ quote, payout } = await quoteAndPayout({ amountCents, bankAccountId }));
  } catch (error) {
    // Con o sin respuesta de BlindPay, el hash ya quedó usado: no se reintenta solo.
    await updateRampPayout(rowId, { status: "failed", error: error.message }).catch((e) =>
      log?.error("blindpay_payout.record_failed", { rowId, err: e.message })
    );
    throw error;
  }

  try {
    await updateRampPayout(rowId, {
      status: "submitted",
      blindpay_quote_id: quote.id,
      blindpay_payout_id: payout.id,
    });
  } catch (error) {
    // El payout ya existe en BlindPay; la fila sigue en `verified` con el hash usado.
    log?.error("blindpay_payout.record_failed", { rowId, payoutId: payout.id, err: error.message });
  }
  return { quote, payout };
}
