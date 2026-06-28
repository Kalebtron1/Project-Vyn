// Núcleo de BlindPay ON-RAMP (payin SPEI → USDC en la wallet del usuario) — ÚNICA fuente
// de verdad, compartida por:
//   - api/onramp-init.js / onramp-quote.js / onramp-payin.js / onramp-status.js  (Vercel ESM)
//   - backend/server.js                                                          (Express, await import())
//
// Modelo del on-ramp (ver memoria "blindpay-integration" + plan Accesly):
//   Un RECEIVER COMPARTIDO (BLINDPAY_DEMO_RECEIVER_ID, ya con TOS+KYC aprobados en sandbox)
//   con UNA blockchain wallet por usuario (su dirección Stellar de Accesly). La atribución
//   "este SPEI es de tal usuario" vive en el blockchain_wallet_id + el mapping en Supabase.
//   Crear un receiver por usuario chocaría con la aceptación humana del TOS; este modelo la
//   evita y conserva la atribución por usuario. En producción: un receiver KYC por usuario.
//
// Secuencia (verificada contra la API en sandbox):
//   ensureBlockchainWallet (1 vez/usuario) → POST /payin-quotes (spei/USDB) → POST /payins/evm
//   → la respuesta trae la `clabe`; el usuario paga por SPEI y, en dev, BlindPay auto-acredita
//   el USDB a la wallet ~30s después. La UI habla en MXN (sender) / USDC (receiver).

import { getOnrampUserByWallet, upsertOnrampUser, hasSettledPayin, recordSettlement } from "./_supabase.mjs";
import { sendUsdcFromAdmin } from "./_usdc.mjs";

const BASE_URL = process.env.BLINDPAY_BASE_URL || "https://api.blindpay.com/v1";

// Defaults de testnet/sandbox. En mainnet: network "stellar", token "USDC".
export const ONRAMP_NETWORK = process.env.BLINDPAY_ONRAMP_NETWORK || "stellar_testnet";
export const ONRAMP_TOKEN = process.env.BLINDPAY_TOKEN || "USDB";
export const ONRAMP_PAYMENT_METHOD = "spei";

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

// Garantiza que el usuario (identificado por su dirección Stellar de Accesly) tenga una
// blockchain wallet registrada en el receiver compartido. Cachea el id en Supabase.
// Devuelve { receiverId, blockchainWalletId, reused }.
export async function ensureBlockchainWallet({ walletAddress, email }) {
  const { instanceId, receiverId } = getConfig();
  if (!walletAddress) throw new Error("ensureBlockchainWallet: falta walletAddress");

  const existing = await getOnrampUserByWallet(walletAddress);
  if (existing && existing.blindpay_blockchain_wallet_id) {
    return {
      receiverId: existing.blindpay_receiver_id || receiverId,
      blockchainWalletId: existing.blindpay_blockchain_wallet_id,
      reused: true,
    };
  }

  const wallet = await bpFetch(
    `/instances/${instanceId}/receivers/${receiverId}/blockchain-wallets`,
    {
      method: "POST",
      body: {
        name: email ? `Vyn · ${email}` : `Vyn · ${walletAddress.slice(0, 8)}`,
        network: ONRAMP_NETWORK,
        is_account_abstraction: true,
        address: walletAddress,
      },
    }
  );

  await upsertOnrampUser({
    wallet_address: walletAddress,
    email: email || null,
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
// generar la CLABE. Devuelve { quote, payin }.
export async function quoteAndPayin({ blockchainWalletId, amountCents, coverFees = false }) {
  const quote = await createPayinQuote({ blockchainWalletId, amountCents, coverFees });
  const payin = await initiatePayin({ payinQuoteId: quote.id });
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
export async function settlePayin({ payinId, simulate = false }) {
  if (!payinId) throw new Error("settlePayin: falta payinId");
  const payin = await getPayin(payinId);

  const paid =
    payin?.status === "completed" ||
    payin?.tracking_payment?.step === "completed" ||
    payin?.tracking_transaction?.step === "completed";

  // Modo simulación (solo sandbox/testnet): BlindPay no expone un endpoint para "forzar"
  // la confirmación del SPEI en dev (auto-acredita ~30s después de iniciar el payin), así
  // que para demos permitimos liquidar sin esperar esa confirmación. Esto ejercita la pata
  // on-chain real (tesorería/admin → wallet del usuario → vault), que es lo verificable.
  const canSimulate = ONRAMP_TOKEN === "USDB" || ONRAMP_NETWORK.includes("testnet");
  const forced = simulate && canSimulate && !paid;
  if (!paid && !forced) return { settled: false, reason: "not_paid", status: payin?.status || null };

  if (await hasSettledPayin(payinId)) return { settled: false, reason: "already_settled" };

  const to = payin.address; // wallet del usuario (la registrada como blockchain wallet)
  const amountUsd = (payin.receiver_amount || 0) / 100;
  if (!to || !(amountUsd > 0)) throw new Error("Payin sin dirección/monto válidos para liquidar");

  const hash = await sendUsdcFromAdmin({ to, amount: amountUsd.toFixed(7) });
  await recordSettlement(payinId, { walletAddress: to, amountUsd, hash });
  return { settled: true, to, amountUsd, hash, simulated: forced };
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
