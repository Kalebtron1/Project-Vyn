// Faucet de USDC (testnet) — envía una pequeña cantidad de USDC del vault a la wallet del
// usuario para que pueda probar un depósito. El USDC sale de la cuenta admin (que ya tiene
// trustline a USDC GATALTGT y se fondea manualmente con N USDC). Una sola vez por wallet.

import { Horizon } from "@stellar/stellar-sdk";
import { hasClaimedFaucet, recordFaucetClaim } from "./_supabase.mjs";
import { HORIZON_URL, usdcBalance, sendUsdcFromAdmin } from "./_usdc.mjs";

const FAUCET_AMOUNT = process.env.FAUCET_USDC_AMOUNT || "2";

// Envía FAUCET_AMOUNT USDC al destino. Devuelve { sent, hash?, reason? }.
export async function sendFaucetUsdc({ to }) {
  if (!to || !/^G[A-Z2-7]{55}$/.test(to)) throw new Error("Dirección Stellar inválida");
  const server = new Horizon.Server(HORIZON_URL);

  // Una sola vez por wallet (aunque luego gaste/deposite el USDC). El dedup es secundario:
  // si Supabase falla (clave inválida, tabla ausente, red), NO bloqueamos el envío de USDC,
  // que es lo importante. Solo lo registramos.
  try {
    if (await hasClaimedFaucet(to)) {
      return { sent: false, reason: "already_claimed" };
    }
  } catch (e) {
    console.warn("faucet: hasClaimedFaucet falló, continúo sin dedup:", e?.message || e);
  }

  // La trustline pudo enviarse hace un instante; un nodo de Horizon con lag aún no la ve.
  // Reintentar la lectura un par de veces antes de rendirse (evita falsos no_trustline).
  let balance = await usdcBalance(server, to);
  for (let i = 0; balance === null && i < 3; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    balance = await usdcBalance(server, to);
  }
  if (balance === null) {
    return { sent: false, reason: "no_trustline" }; // el usuario debe activar USDC primero
  }

  const hash = await sendUsdcFromAdmin({ to, amount: FAUCET_AMOUNT });
  // Registrar el claim es best-effort: si Supabase falla, el USDC ya se envió igual.
  try {
    await recordFaucetClaim(to); // marca la wallet como ya fondeada (una sola vez)
  } catch (e) {
    console.warn("faucet: recordFaucetClaim falló (USDC ya enviado):", e?.message || e);
  }
  return { sent: true, hash, amount: FAUCET_AMOUNT };
}
