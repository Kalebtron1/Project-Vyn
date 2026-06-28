// Helper compartido para mover USDC (testnet) desde la cuenta admin del proyecto.
// Lo usan el faucet (api/_faucet-core.mjs) y la liquidación del on-ramp (settlePayin).
// Pago CLÁSICO vía Horizon, firmado con SECRET_KEY_ADMIN.

import { Horizon, TransactionBuilder, Operation, Asset, Keypair, BASE_FEE, Networks } from "@stellar/stellar-sdk";

export const HORIZON_URL = "https://horizon-testnet.stellar.org";

// USDC del vault (testnet). Issuer del proyecto (el que tienen las wallets de prueba).
export const USDC = new Asset("USDC", "GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56");

/** Saldo USDC de una cuenta. null = sin trustline / cuenta inexistente. */
export async function usdcBalance(server, address) {
  try {
    const acc = await server.loadAccount(address);
    const line = acc.balances.find(
      (b) => b.asset_code === "USDC" && b.asset_issuer === USDC.getIssuer()
    );
    return line ? parseFloat(line.balance) : null;
  } catch {
    return null;
  }
}

/** Envía `amount` USDC desde la cuenta admin a `to`. Devuelve el hash. */
export async function sendUsdcFromAdmin({ to, amount }) {
  if (!to || !/^G[A-Z2-7]{55}$/.test(to)) throw new Error("Dirección Stellar inválida");
  const secret = process.env.SECRET_KEY_ADMIN;
  if (!secret) throw new Error("Falta SECRET_KEY_ADMIN");
  const server = new Horizon.Server(HORIZON_URL);
  const kp = Keypair.fromSecret(secret);
  const source = await server.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: to, asset: USDC, amount: String(amount) }))
    .setTimeout(120)
    .build();
  tx.sign(kp);
  try {
    const res = await server.submitTransaction(tx);
    return res.hash;
  } catch (e) {
    const codes = e?.response?.data?.extras?.result_codes;
    throw new Error(codes ? `Horizon: ${JSON.stringify(codes)}` : (e?.message || "Error enviando USDC"));
  }
}
