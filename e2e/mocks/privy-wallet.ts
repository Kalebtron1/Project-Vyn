/**
 * Shared state for the Privy E2E stubs (`privy.tsx`, `privy-extended.ts`) and the
 * specs that drive them.
 *
 * The stub persists its session in localStorage like Privy does, so specs can test
 * reloads and seed a leftover Privy session. Calls are recorded on
 * `window.__e2ePrivyCalls` so specs can assert on them.
 */

import { Keypair } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";

export const E2E_PRIVY_AUTH_KEY = "e2e_privy_authenticated";
/** Optional delay (ms) before the stub reports `ready`, to test early clicks. */
export const E2E_PRIVY_READY_DELAY_KEY = "e2e_privy_ready_delay";
/** When set, `login()` fails with this message the way Privy's OAuth buttons do. */
export const E2E_PRIVY_LOGIN_FAILURE_KEY = "e2e_privy_login_failure";
export const E2E_PRIVY_EMAIL = "e2e@vyn.test";

/** Test-only wallet (testnet, never funded). Derived from a fixed seed so no secret is stored. */
export function e2ePrivyKeypair(): Keypair {
  return Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
}

export type PrivyCall = "login" | "logout" | "exportWallet" | "signRawHash";

export function recordPrivyCall(call: PrivyCall): void {
  const w = window as unknown as { __e2ePrivyCalls?: PrivyCall[] };
  (w.__e2ePrivyCalls ??= []).push(call);
}
