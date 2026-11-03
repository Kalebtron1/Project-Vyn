// Núcleo de BlindPay ON-RAMP (payin SPEI → USDC en la wallet del usuario) — ÚNICA fuente
// de verdad, compartida por:
//   - api/onramp-init.js / onramp-quote.js / onramp-payin.js / onramp-status.js  (Vercel ESM)
//   - backend/server.js                                                          (Express, await import())
//
// Modelo del on-ramp (ver memoria "blindpay-integration"):
//   Un RECEIVER COMPARTIDO (BLINDPAY_DEMO_RECEIVER_ID, ya con TOS+KYC aprobados en sandbox)
//   con UNA blockchain wallet por usuario (su dirección Stellar de Privy). La atribución
//   "este SPEI es de tal usuario" vive en el blockchain_wallet_id + el mapping en Supabase.
//   Crear un receiver por usuario chocaría con la aceptación humana del TOS; este modelo la
//   evita y conserva la atribución por usuario. En producción: un receiver KYC por usuario.
//
// Secuencia (verificada contra la API en sandbox):
//   ensureBlockchainWallet (1 vez/usuario) → POST /payin-quotes (spei/USDB) → POST /payins/evm
//   → la respuesta trae la `clabe`; el usuario paga por SPEI y, en dev, BlindPay auto-acredita
//   el USDB a la wallet ~30s después. La UI habla en MXN (sender) / USDC (receiver).

import {
  finishSettlement,
  getLegacyOnrampUser,
  getRampCustomer,
  getRampPayin,
  getSettlementStatus,
  reserveSettlement,
  saveRampPayin,
  updateRampPayinStatus,
  upsertRampCustomer,
} from "./_supabase.mjs";
import { sendUsdcFromAdmin } from "./_usdc.mjs";

const BASE_URL = process.env.BLINDPAY_BASE_URL || "https://api.blindpay.com/v1";

// Defaults de testnet/sandbox. En mainnet: network "stellar", token "USDC".
export const ONRAMP_NETWORK = process.env.BLINDPAY_ONRAMP_NETWORK || "stellar_testnet";
export const ONRAMP_TOKEN = process.env.BLINDPAY_TOKEN || "USDB";
export const ONRAMP_PAYMENT_METHOD = "spei";

// Topes en centavos de USD. En desarrollo BlindPay completa cualquier payin sin que nadie
// pague, así que estos topes son lo que acota lo que sale de la cuenta admin.
function capCents(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
const maxPayinCents = () => capCents("ONRAMP_MAX_PAYIN_USD_CENTS", 10_000);
const walletDailyCapCents = () => capCents("ONRAMP_WALLET_DAILY_USD_CENTS", 20_000);
const globalDailyCapCents = () => capCents("ONRAMP_GLOBAL_DAILY_USD_CENTS", 100_000);

/** Lanza un error con `reason: "payin_cap"` si el monto a recibir pasa del tope por payin. */
export function assertPayinWithinCap(receiverCents) {
  const max = maxPayinCents();
  if (receiverCents > max) {
    const err = new Error(`El depósito supera el máximo de ${max / 100} USD`);
    err.reason = "payin_cap";
    err.maxUsd = max / 100;
    throw err;
  }
}

function getConfig() {
  const apiKey = process.env.BLINDPAY_API_KEY;
  const instanceId = process.env.BLINDPAY_INSTANCE_ID;
  const receiverId = process.env.BLINDPAY_DEMO_RECEIVER_ID;
  if (!apiKey || !instanceId) {
    throw new Error("BlindPay no configurado: faltan BLINDPAY_API_KEY / BLINDPAY_INSTANCE_ID");
  }
  if (!receiverId) {
    throw new Error("On-ramp no configurado: falta BLINDPAY_DEMO_RECEIVER_ID (receiver compartido)");
  }
  return { apiKey, instanceId, receiverId };
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
    // Un 301 convierte el POST en GET: la API responde 200 sin haber creado nada.
    redirect: "error",
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

// Garantiza que el usuario (identificado por su dirección Stellar de Privy) tenga una
// blockchain wallet registrada en el receiver compartido. Cachea el id en Supabase.
// Devuelve { receiverId, blockchainWalletId, reused }.
export async function ensureBlockchainWallet({ walletAddress, email }) {
  const { instanceId, receiverId } = getConfig();
  if (!walletAddress) throw new Error("ensureBlockchainWallet: falta walletAddress");

  const existing = await getRampCustomer(walletAddress);
  if (existing) {
    return {
      receiverId: existing.blindpay_receiver_id,
      blockchainWalletId: existing.blindpay_blockchain_wallet_id,
      reused: true,
    };
  }

  // ramp_payins exige la fila en ramp_customers, así que lo de la tabla vieja se copia.
  const legacy = await getLegacyOnrampUser(walletAddress);
  if (legacy?.blindpay_blockchain_wallet_id) {
    const legacyReceiverId = legacy.blindpay_receiver_id || receiverId;
    await upsertRampCustomer({
      wallet_address: walletAddress,
      blindpay_receiver_id: legacyReceiverId,
      blindpay_blockchain_wallet_id: legacy.blindpay_blockchain_wallet_id,
    });
    return { receiverId: legacyReceiverId, blockchainWalletId: legacy.blindpay_blockchain_wallet_id, reused: true };
  }

  const wallet = await bpFetch(
    `/instances/${instanceId}/customers/${receiverId}/blockchain-wallets`,
    {
      method: "POST",
      body: {
        name: email ? `Vyn · ${email}` : `Vyn · ${walletAddress.slice(0, 8)}`,
        network: ONRAMP_NETWORK,
        // Es el registro por dirección directa: la única opción en Stellar, pese al nombre.
        is_account_abstraction: true,
        address: walletAddress,
      },
    }
  );
  // Sin id no hay forma de cotizar: mejor fallar aquí que guardar una fila incompleta.
  if (!wallet?.id) throw new Error("BlindPay no devolvió el id de la blockchain wallet");

  await upsertRampCustomer({
    wallet_address: walletAddress,
    blindpay_receiver_id: receiverId,
    blindpay_blockchain_wallet_id: wallet.id,
  });

  return { receiverId, blockchainWalletId: wallet.id, reused: false };
}

// Crea un payin-quote SPEI→USDB para la blockchain wallet del usuario.
// amountCents: monto del SENDER en centavos de MXN (100000 = $1,000.00 MXN). Mínimo 500.
export async function createPayinQuote({ blockchainWalletId, amountCents, coverFees = false }) {
  const { instanceId } = getConfig();
  if (!blockchainWalletId) throw new Error("createPayinQuote: falta blockchainWalletId");
  if (!Number.isInteger(amountCents) || amountCents < 500) {
    throw new Error("createPayinQuote: amountCents debe ser un entero >= 500");
  }
  const partnerFeeId = process.env.BLINDPAY_PARTNER_FEE_ID || undefined;
  return bpFetch(`/instances/${instanceId}/payin-quotes`, {
    method: "POST",
    body: {
      blockchain_wallet_id: blockchainWalletId,
      currency_type: "sender",
      cover_fees: coverFees,
      request_amount: amountCents,
      payment_method: ONRAMP_PAYMENT_METHOD,
      token: ONRAMP_TOKEN,
      ...(partnerFeeId ? { partner_fee_id: partnerFeeId } : {}),
    },
  });
}

// Inicia el payin para un quote ya creado. Devuelve el payin (incluye `clabe`).
export async function initiatePayin({ payinQuoteId }) {
  const { instanceId } = getConfig();
  if (!payinQuoteId) throw new Error("initiatePayin: falta payinQuoteId");
  return bpFetch(`/instances/${instanceId}/payins/evm`, {
    method: "POST",
    body: { payin_quote_id: payinQuoteId },
  });
}

// Quote + payin en un solo paso (el quote caduca en 5 min): se cotiza FRESCO justo antes de
// generar la CLABE. El payin queda ligado a la wallet; si no se puede guardar, el usuario no
// recibe la CLABE y ese payin nunca se liquida. Devuelve { quote, payin }.
export async function quoteAndPayin({ walletAddress, blockchainWalletId, amountCents, coverFees = false }) {
  if (!walletAddress) throw new Error("quoteAndPayin: falta walletAddress");
  const quote = await createPayinQuote({ blockchainWalletId, amountCents, coverFees });
  assertPayinWithinCap(quote.receiver_amount);
  const payin = await initiatePayin({ payinQuoteId: quote.id });
  if (!payin?.id) throw new Error("BlindPay no devolvió el id del payin");
  await saveRampPayin({
    payin_id: payin.id,
    wallet_address: walletAddress,
    sender_mxn_cents: quote.sender_amount,
    receiver_usd_cents: quote.receiver_amount,
    status: payin.status || "processing",
  });
  return { quote, payin };
}

export async function getPayin(payinId) {
  const { instanceId } = getConfig();
  if (!payinId) throw new Error("getPayin: falta payinId");
  return bpFetch(`/instances/${instanceId}/payins/${payinId}`);
}

// LIQUIDACIÓN (Fase 6): una vez que BlindPay confirma el SPEI, materializamos el USDC en
// la wallet del usuario. En testnet, en lugar de pelear con el USDB (que la wallet del
// usuario no confía), la tesorería/admin envía el USDC equivalente directo a su wallet —
// misma idea que el off-ramp (el USDB es un artefacto invisible). Idempotente por payin.
// El frontend luego deposita ese USDC al vault (lo firma la wallet del usuario con Privy).
// BlindPay confirma el pago. Un estado final sin pago manda sobre los pasos de `tracking_*`:
// un payin reembolsado puede tener el paso de pago completado, y no debe liquidarse.
export function isPayinPaid(payin) {
  if (payin?.status === "failed" || payin?.status === "refunded") return false;
  return (
    payin?.status === "completed" ||
    payin?.tracking_payment?.step === "completed" ||
    payin?.tracking_transaction?.step === "completed"
  );
}

const usdcAmount = (cents) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}00000`;

// El USDC siempre va a la wallet con la que se creó el payin, nunca a una que mande quien llama.
// Reserva antes de enviar: de varias llamadas paralelas, solo la que reservó paga.
export async function settlePayin({ payinId, walletAddress, log }) {
  if (!payinId) throw new Error("settlePayin: falta payinId");
  const bound = await getRampPayin(payinId);
  if (!bound) return { settled: false, reason: "unknown_payin" };
  if (bound.wallet_address !== walletAddress) return { settled: false, reason: "forbidden" };

  const payin = await getPayin(payinId);
  if (payin?.status && payin.status !== bound.status) await updateRampPayinStatus(payinId, payin.status);
  if (!isPayinPaid(payin)) return { settled: false, reason: "not_paid", status: payin?.status || null };
  if (payin.address !== bound.wallet_address) return { settled: false, reason: "payin_mismatch" };

  // Se paga lo que se cotizó al crear el payin, y nunca más de lo que BlindPay confirma.
  const cents = Math.min(Number(bound.receiver_usd_cents), payin.receiver_amount);
  if (!Number.isSafeInteger(cents) || cents <= 0) return { settled: false, reason: "payin_mismatch" };
  try {
    assertPayinWithinCap(cents);
  } catch (error) {
    return { settled: false, reason: error.reason, maxUsd: error.maxUsd };
  }

  const reservation = await reserveSettlement({
    payinId,
    walletAddress: bound.wallet_address,
    amountCents: cents,
    walletDailyCapCents: walletDailyCapCents(),
    globalDailyCapCents: globalDailyCapCents(),
  });
  if (reservation === "already_reserved") {
    const existing = await getSettlementStatus(payinId);
    // Una reserva sin terminar puede estar en curso o haber quedado a medias: no se da por pagada.
    if (existing?.status === "sent") return { settled: false, reason: "already_settled", hash: existing.tx_hash };
    return { settled: false, reason: "in_review" };
  }
  if (reservation !== "reserved") return { settled: false, reason: reservation };

  let hash;
  try {
    hash = await sendUsdcFromAdmin({ to: bound.wallet_address, amount: usdcAmount(cents) });
  } catch (error) {
    if (!error.notSent) {
      // Pudo haber entrado a la red: la reserva se queda bloqueada para revisión manual (ADR-007).
      log?.error("onramp_settle.send_unknown", { payinId, err: error.message });
      return { settled: false, reason: "in_review" };
    }
    await finishSettlement(payinId, { error: error.message });
    throw error;
  }

  try {
    await finishSettlement(payinId, { txHash: hash });
  } catch (error) {
    // El USDC ya salió. La reserva sigue cerrada, así que un reintento no paga otra vez.
    log?.error("onramp_settle.finish_failed", { payinId, hash, err: error.message });
  }
  return { settled: true, to: bound.wallet_address, amountUsd: cents / 100, hash };
}

// Recorta un payin-quote a lo que la UI necesita. Para on-ramp el SENDER es MXN y el
// RECEIVER es USDC/USDB; montos en centavos, quotations ×100.
export function summarizePayinQuote(q) {
  if (!q) return null;
  return {
    quoteId: q.id,
    senderMxn: q.sender_amount / 100,
    receiverUsd: q.receiver_amount / 100,
    flatFeeUsd: (q.flat_fee || 0) / 100,
    partnerFeeUsd: (q.partner_fee_amount || 0) / 100,
    rateMxnPerUsd: q.blindpay_quotation / 100,
    commercialRateMxnPerUsd: q.commercial_quotation / 100,
    expiresAt: q.expires_at,
  };
}

// Recorta un payin a lo esencial para la UI / polling.
export function summarizePayin(p) {
  if (!p) return null;
  return {
    payinId: p.id,
    status: p.status,
    clabe: p.clabe || null,
    senderMxn: p.sender_amount != null ? p.sender_amount / 100 : null,
    receiverUsd: p.receiver_amount != null ? p.receiver_amount / 100 : null,
    address: p.address || null,
    network: p.network || null,
    tracking: p.tracking_complete || p.tracking_transaction || null,
    payment: p.tracking_payment || null,
    // hash on-chain del USDB acreditado (cuando completa)
    txHash: (p.tracking_complete && p.tracking_complete.transaction_hash) || null,
  };
}
