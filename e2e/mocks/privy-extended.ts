/**
 * E2E stub for `@privy-io/react-auth/extended-chains`.
 * Signs with the test wallet from `privy-wallet.ts`, so PrivyBridge's real signing
 * path (hash → Ed25519 signature → local verify → XDR) runs during Playwright runs.
 */

import { Buffer } from "buffer";
import { e2ePrivyKeypair, e2ePrivyKeypairFor, recordPrivyCall } from "./privy-wallet";

export function useSignRawHash() {
  return {
    signRawHash: async ({ address, hash }: { address: string; chainType: string; hash: string }) => {
      recordPrivyCall("signRawHash");
      const signature = e2ePrivyKeypairFor(address).sign(Buffer.from(hash.replace(/^0x/, ""), "hex"));
      return { signature: `0x${Buffer.from(signature).toString("hex")}` };
    },
  };
}

export function useCreateWallet() {
  return {
    createWallet: async () => ({ wallet: { address: e2ePrivyKeypair().publicKey() } }),
  };
}

export function useExportWallet() {
  return {
    exportWallet: async (_options: { address: string }) => {
      recordPrivyCall("exportWallet");
    },
  };
}
