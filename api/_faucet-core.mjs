// Faucet de USDC (testnet) — envía una pequeña cantidad de USDC del vault a la wallet del
// usuario para que pueda probar un depósito. El USDC sale de la cuenta admin (que ya tiene
// trustline a USDC GATALTGT y se fondea manualmente con N USDC). Una sola vez por wallet, con
// tope por IP y presupuesto global del día: wallets nuevas son gratis con Friendbot, y el
// presupuesto es lo que acota lo que puede salir aunque rodeen lo demás.

import { createHash } from "node:crypto";
import { Horizon } from "@stellar/stellar-sdk";
import { finishFaucet, hasClaimedFaucet, reserveFaucet } from "./_supabase.mjs";
import { HORIZON_URL, usdcBalance, sendUsdcFromAdmin } from "./_usdc.mjs";

function positiveInt(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function notConfigured(message) {
  const err = new Error(message);
  err.code = "faucet_not_configured";
  return err;
}

// IP del cliente. Vercel escribe estos encabezados, así que quien llama no los puede falsificar.
// Sin IP, todos comparten el mismo tope en lugar de quedar sin límite.
export function clientIp(req) {
  const headers = req?.headers || {};
  const forwarded = headers["x-vercel-forwarded-for"] || headers["x-real-ip"] || headers["x-forwarded-for"];
  const first = String(forwarded || "").split(",")[0].trim();
  return first || req?.socket?.remoteAddress || "unknown";
}

// Nunca se guarda la IP en claro. Sin sal, un hash de IPv4 se revierte probando todas.
function hashIp(ip) {
  const salt = process.env.FAUCET_IP_SALT;
  if (!salt) throw notConfigured("Faucet no configurado: falta FAUCET_IP_SALT");
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

// Envía FAUCET_USDC_AMOUNT USDC al destino. Devuelve { sent, hash?, reason? }.
export async function sendFaucetUsdc({ to, ip, log }) {
  if (!to || !/^G[A-Z2-7]{55}$/.test(to)) throw new Error("Dirección Stellar inválida");
  const amount = process.env.FAUCET_USDC_AMOUNT || "2";
  const amountCents = Math.round(Number(amount) * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw notConfigured("Faucet no configurado: FAUCET_USDC_AMOUNT inválido");
  }
  const ipHash = hashIp(ip);

  // Reclamos en la tabla vieja que aún no se copian a faucet_grants. Si Supabase falla no se
  // envía nada: sin esta verificación cualquiera podría vaciar la cuenta admin.
  if (await hasClaimedFaucet(to)) {
    return { sent: false, reason: "already_claimed" };
  }

  // La trustline pudo enviarse hace un instante; un nodo de Horizon con lag aún no la ve.
  // Reintentar la lectura un par de veces antes de rendirse (evita falsos no_trustline).
  const server = new Horizon.Server(HORIZON_URL);
  let balance = await usdcBalance(server, to);
  for (let i = 0; balance === null && i < 3; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    balance = await usdcBalance(server, to);
  }
  if (balance === null) {
    return { sent: false, reason: "no_trustline" }; // el usuario debe activar USDC primero
  }

  const reservation = await reserveFaucet({
    walletAddress: to,
    ipHash,
    amountCents,
    ipDailyMax: positiveInt("FAUCET_IP_DAILY_MAX", 5),
    globalDailyCapCents: positiveInt("FAUCET_DAILY_BUDGET_USD_CENTS", 5_000),
  });
  if (reservation !== "reserved") return { sent: false, reason: reservation };

  let hash;
  try {
    hash = await sendUsdcFromAdmin({ to, amount });
  } catch (error) {
    if (!error.notSent) {
      // Pudo haber entrado a la red: la reserva se queda bloqueada para revisión manual (ADR-007).
      log?.error("faucet_usdc.send_unknown", { err: error.message });
      return { sent: false, reason: "in_review" };
    }
    await finishFaucet(to);
    throw error;
  }

  try {
    await finishFaucet(to, hash);
  } catch (error) {
    // El USDC ya salió. La reserva sigue cerrada, así que la wallet no puede reclamar otra vez.
    log?.error("faucet_usdc.finish_failed", { hash, err: error.message });
  }
  return { sent: true, hash, amount };
}
