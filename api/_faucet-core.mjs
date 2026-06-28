// Faucet de USDC (testnet) — envía una pequeña cantidad de USDC del vault a la wallet del
// usuario para que pueda probar un depósito. El USDC sale de la cuenta admin (que ya tiene
// trustline a USDC GATALTGT y se fondea manualmente con N USDC). Pago CLÁSICO vía Horizon.
//
// Guarda anti-drenaje: si el destino ya tiene >= FAUCET_AMOUNT USDC, no envía de nuevo.

import { Horizon, TransactionBuilder, Operation, Asset, Keypair, BASE_FEE, Networks } from "@stellar/stellar-sdk";
import { hasClaimedFaucet, recordFaucetClaim } from "./_supabase.mjs";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const USDC = new Asset("USDC", "GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56");
const FAUCET_AMOUNT = process.env.FAUCET_USDC_AMOUNT || "2";

function getKeypair() {
  const secret = process.env.SECRET_KEY_ADMIN;
  if (!secret) throw new Error("Faucet no configurado: falta SECRET_KEY_ADMIN");
  return Keypair.fromSecret(secret);
}

async function usdcBalance(server, address) {
  try {
    const acc = await server.loadAccount(address);
    const line = acc.balances.find(
      (b) => b.asset_code === "USDC" && b.asset_issuer === USDC.getIssuer()
    );
    return line ? parseFloat(line.balance) : null; // null = sin trustline
  } catch {
    return null; // cuenta no existe aún
  }
}

// Envía FAUCET_AMOUNT USDC al destino. Devuelve { sent, hash?, reason? }.
export async function sendFaucetUsdc({ to }) {
  if (!to || !/^G[A-Z2-7]{55}$/.test(to)) throw new Error("Dirección Stellar inválida");
  const server = new Horizon.Server(HORIZON_URL);

  // Una sola vez por wallet (aunque luego gaste/deposite el USDC).
  if (await hasClaimedFaucet(to)) {
    return { sent: false, reason: "already_claimed" };
  }

  const balance = await usdcBalance(server, to);
  if (balance === null) {
    return { sent: false, reason: "no_trustline" }; // el usuario debe activar USDC primero
  }

  const kp = getKeypair();
  const source = await server.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: to, asset: USDC, amount: String(FAUCET_AMOUNT) }))
    .setTimeout(120)
    .build();
  tx.sign(kp);

  try {
    const res = await server.submitTransaction(tx);
    await recordFaucetClaim(to); // marca la wallet como ya fondeada (una sola vez)
    return { sent: true, hash: res.hash, amount: FAUCET_AMOUNT };
  } catch (e) {
    const codes = e?.response?.data?.extras?.result_codes;
    const err = new Error(codes ? `Horizon: ${JSON.stringify(codes)}` : (e?.message || "Error enviando USDC"));
    throw err;
  }
}
