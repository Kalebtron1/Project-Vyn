/**
 * txPoller.ts
 * -----------
 * Polls the Soroban RPC for a submitted transaction until it reaches a
 * terminal state (SUCCESS or FAILED) or the retry budget is exhausted.
 *
 * Design decisions
 * ----------------
 * - Bounded retries: avoids infinite polling that could silently duplicate user intent.
 * - Exponential back-off with a cap: gentle on the RPC, fast enough for UX.
 * - Always resolves with an explicit TxPollResult — callers must handle both outcomes.
 */

import { rpc } from "@stellar/stellar-sdk";

export type TxPollStatus = "SUCCESS" | "FAILED" | "TIMEOUT";

export interface TxPollResult {
  status: TxPollStatus;
  /** Present on SUCCESS */
  hash?: string;
  /** Present on FAILED or TIMEOUT — human-readable reason */
  reason?: string;
}

const RPC_URL = "https://soroban-testnet.stellar.org";

const INITIAL_DELAY_MS = 2_000;
const MAX_DELAY_MS = 10_000;
const MAX_ATTEMPTS = 10; // ~60 s total upper bound

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll until the transaction reaches a terminal on-chain state.
 *
 * @param hash - The transaction hash returned by `server.sendTransaction()`
 * @returns A resolved promise with the terminal status and optional detail.
 */
export async function pollTransaction(hash: string): Promise<TxPollResult> {
  const server = new rpc.Server(RPC_URL);
  let waitMs = INITIAL_DELAY_MS;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await delay(waitMs);

    try {
      const result = await server.getTransaction(hash);
      const status = (result.status as string).toUpperCase();

      if (status === "SUCCESS") {
        return { status: "SUCCESS", hash };
      }

      if (status === "FAILED") {
        return {
          status: "FAILED",
          hash,
          reason: "La transacción fue rechazada por la red Stellar.",
        };
      }

      // status === "NOT_FOUND" or "PENDING" → keep polling
    } catch (err: any) {
      // Transient network error — keep retrying within budget
      console.warn(`[txPoller] attempt ${attempt + 1} failed:`, err?.message);
    }

    // Exponential back-off, capped
    waitMs = Math.min(waitMs * 1.5, MAX_DELAY_MS);
  }

  return {
    status: "TIMEOUT",
    reason:
      "No se pudo confirmar el estado de la transacción. Revisa el explorador de Stellar y vuelve a intentarlo.",
  };
}
