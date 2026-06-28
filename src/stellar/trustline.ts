/**
 * Trustline USDC — la wallet de Privy (login con correo) nace sin trustlines. Para
 * recibir/depositar USDC primero debe confiar el asset. Este `changeTrust` lo firma la
 * propia wallet (Privy o externa) vía la capa `signTransactionXdr`, y se envía a Horizon.
 *
 * Sirve además como primera prueba real de la firma de Privy (tx clásica Stellar).
 */

import { TransactionBuilder, Operation, Asset, BASE_FEE, Networks, Horizon } from "@stellar/stellar-sdk";

const HORIZON_URL = "https://horizon-testnet.stellar.org";

// USDC del vault (testnet). Issuer del proyecto (el que tienen las wallets de prueba).
export const USDC_ASSET = new Asset(
  "USDC",
  "GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56"
);

/** ¿La cuenta ya confía USDC del issuer del vault? (false si no existe on-chain). */
export async function hasUsdcTrustline(address: string): Promise<boolean> {
  const res = await fetch(`${HORIZON_URL}/accounts/${address}`);
  if (!res.ok) return false;
  const data = await res.json();
  return (data.balances || []).some(
    (b: { asset_code?: string; asset_issuer?: string }) =>
      b.asset_code === "USDC" && b.asset_issuer === USDC_ASSET.getIssuer()
  );
}

/** Saldo USDC (trustline) de la cuenta. 0 si no existe o no confía USDC. */
export async function getUsdcBalance(address: string): Promise<number> {
  const res = await fetch(`${HORIZON_URL}/accounts/${address}`);
  if (!res.ok) return 0;
  const data = await res.json();
  const line = (data.balances || []).find(
    (b: { asset_code?: string; asset_issuer?: string }) =>
      b.asset_code === "USDC" && b.asset_issuer === USDC_ASSET.getIssuer()
  );
  return line ? parseFloat(line.balance) : 0;
}

/** Construye el XDR de changeTrust(USDC) para que lo firme la wallet del usuario. */
export async function buildUsdcTrustlineXdr(address: string): Promise<string> {
  const server = new Horizon.Server(HORIZON_URL);
  const account = await server.loadAccount(address);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.changeTrust({ asset: USDC_ASSET }))
    .setTimeout(120)
    .build();
  return tx.toXDR();
}

/** Envía un XDR ya firmado a Horizon (tx clásica). Devuelve el hash. */
export async function submitClassicXdr(signedXdr: string): Promise<string> {
  const server = new Horizon.Server(HORIZON_URL);
  const tx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
  try {
    const res = await server.submitTransaction(tx as Parameters<typeof server.submitTransaction>[0]);
    return res.hash;
  } catch (e: unknown) {
    // Horizon devuelve los códigos del fallo en extras.result_codes — exponerlos para diagnosticar.
    const codes = (e as { response?: { data?: { extras?: { result_codes?: unknown } } } })?.response?.data?.extras?.result_codes;
    if (codes) throw new Error(`Horizon: ${JSON.stringify(codes)}`);
    throw e;
  }
}
