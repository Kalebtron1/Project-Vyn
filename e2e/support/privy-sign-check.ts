/**
 * Loaded inside the page by `privy-lazy.spec.ts` (through the Vite dev server), so it
 * shares the app's `privyBridge` instance. It signs a throwaway transaction through
 * `privySign`, which is the same path the app uses for deposits and withdrawals.
 */

import { Account, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { privySign } from "@/lib/privyBridge";

export async function signThroughPrivy(address: string) {
  const tx = new TransactionBuilder(new Account(address, "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.bumpSequence({ bumpTo: "2" }))
    .setTimeout(30)
    .build();

  const signedXdr = await privySign(tx.toXDR());
  const signed = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
  const [signature] = signed.signatures;
  return {
    signatures: signed.signatures.length,
    valid: Boolean(signature) && Keypair.fromPublicKey(address).verify(signed.hash(), signature.signature()),
  };
}
