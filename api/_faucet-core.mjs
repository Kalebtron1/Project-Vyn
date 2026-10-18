// Faucet de USDC (testnet) — envía una pequeña cantidad de USDC del vault a la wallet del
// usuario para que pueda probar un depósito. El USDC sale de la cuenta admin (que ya tiene
// trustline a USDC GATALTGT y se fondea manualmente con N USDC). Una sola vez por wallet,
// con rate-limiting diario por IP y global y dedup fail-closed.

import { Horizon } from "@stellar/stellar-sdk";
import {
  hasClaimedFaucet,
  checkFaucetRateLimit,
  recordFaucetClaim,
} from "./_supabase.mjs";
import { HORIZON_URL, usdcBalance, sendUsdcFromAdmin } from "./_usdc.mjs";

const FAUCET_AMOUNT = process.env.FAUCET_USDC_AMOUNT || "2";

function getRateLimits(env = process.env) {
  const ipDailyLimit = Math.max(1, Number(env?.FAUCET_IP_DAILY_LIMIT) || 3);
  const globalDailyLimit = Math.max(1, Number(env?.FAUCET_GLOBAL_DAILY_LIMIT) || 50);
  return { ipDailyLimit, globalDailyLimit };
}

// Envía FAUCET_AMOUNT USDC al destino. Devuelve { sent, hash?, reason?, statusCode? }.
export async function sendFaucetUsdc({ to, ip = "unknown", env = process.env }) {
  if (!to || !/^G[A-Z2-7]{55}$/.test(to)) {
    throw new Error("Dirección Stellar inválida");
  }

  const { ipDailyLimit, globalDailyLimit } = getRateLimits(env);

  // Dedup fail-closed: si la tienda de dedup/rate-limit falla, NO enviamos USDC.
  try {
    if (await hasClaimedFaucet(to)) {
      return { sent: false, reason: "already_claimed", statusCode: 200 };
    }
    const rateCheck = await checkFaucetRateLimit({
      ip,
      ipDailyLimit,
      globalDailyLimit,
    });
    if (!rateCheck.allowed) {
      return {
        sent: false,
        reason: "rate_limited",
        limitScope: rateCheck.scope,
        statusCode: 429,
      };
    }
  } catch (e) {
    return {
      sent: false,
      reason: "dedup_unavailable",
      error: e?.message || "No se pudo verificar el historial del faucet",
      statusCode: 503,
    };
  }

  const server = new Horizon.Server(HORIZON_URL);

  // La trustline pudo enviarse hace un instante; un nodo de Horizon con lag aún no la ve.
  // Reintentar la lectura un par de veces antes de rendirse (evita falsos no_trustline).
  let balance = await usdcBalance(server, to);
  for (let i = 0; balance === null && i < 3; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    balance = await usdcBalance(server, to);
  }
  if (balance === null) {
    return { sent: false, reason: "no_trustline", statusCode: 200 };
  }

  const hash = await sendUsdcFromAdmin({ to, amount: FAUCET_AMOUNT });
  try {
    await recordFaucetClaim(to, { ip });
  } catch (e) {
    console.warn("faucet: recordFaucetClaim falló (USDC ya enviado):", e?.message || e);
  }
  return { sent: true, hash, amount: FAUCET_AMOUNT, statusCode: 200 };
}
