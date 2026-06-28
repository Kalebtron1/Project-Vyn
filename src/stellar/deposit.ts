/**
 * depositToVault — deposita USDC en el contrato del vault (staking_pool) firmando con la
 * wallet del usuario (Privy o externa) vía la capa `sign` de useMobileWallet. Reutilizable
 * por el flujo manual (DepositModal) y por la liquidación del on-ramp (Depositar / Fase 6).
 */

import { TransactionBuilder, Networks, Operation, BASE_FEE, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { CONTRACT_ID, RPC_URL } from "@/stellar/contracts";

type SignFn = (xdr: string) => Promise<{ ok: boolean; signedXdr?: string; error?: string; cancelled?: boolean }>;

export async function depositToVault(address: string, amount: number, sign: SignFn): Promise<string> {
  const server = new rpc.Server(RPC_URL);
  const account = await server.getAccount(address);
  const stroops = BigInt(Math.floor(amount * 10_000_000));

  let tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: CONTRACT_ID,
        function: "deposit",
        args: [
          nativeToScVal(address, { type: "address" }),
          nativeToScVal(stroops, { type: "i128" }),
        ],
      })
    )
    .setTimeout(30)
    .build();

  tx = await server.prepareTransaction(tx);
  const res = await sign(tx.toXDR());
  if (!res.ok || !res.signedXdr) throw new Error(res.error || "No se pudo firmar el depósito");

  const submit = await server.sendTransaction(TransactionBuilder.fromXDR(res.signedXdr, Networks.TESTNET));
  const status = (submit.status ?? "").toUpperCase();
  if (status !== "PENDING" && status !== "SUCCESS") {
    throw new Error("La red rechazó el depósito al vault");
  }
  return submit.hash;
}
