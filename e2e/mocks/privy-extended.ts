/**
 * E2E stub for `@privy-io/react-auth/extended-chains`.
 * Keeps PrivyBridge / Perfil from pulling real signing hooks during Playwright runs.
 */

export function useSignRawHash() {
  return {
    signRawHash: async () => ({ signature: "0x" }),
  };
}

export function useCreateWallet() {
  return {
    createWallet: async () => ({}),
  };
}

export function useExportWallet() {
  return {
    exportWallet: async () => {},
  };
}
