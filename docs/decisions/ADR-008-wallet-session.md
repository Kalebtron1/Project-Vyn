---
tags: [adr, auth, security, api]
status: accepted
date: 2026-11-03
issues: [89, 90]
files:
  - api/auth.js
  - api/_session.mjs
  - api/evaluate-and-mint.js
  - src/lib/apiSession.ts
---

# ADR-008: Wallet session with a SEP-10 style challenge

ADR-004 to ADR-006 are on the contracts v2 branch, which has not been merged.

## Context

No API endpoint knew who was calling. `evaluate-and-mint` minted for any address it received,
signed and paid by the admin key (#89). `api/nonce.js` tried to fix that once, but it kept the
nonce in the memory of one function. On Vercel that memory is not shared with other
functions or instances, so verification always failed and the check was removed (#90).

The proof also has to work for every wallet Vyn supports: the Stellar Wallets Kit wallets and
Privy's embedded wallet.

## Options

- **Sign a message (SEP-53, `signMessage`).** Not every wallet in the kit, nor Privy's
  embedded wallet, is known to support it with the same prefix.
- **Privy access token checked on the server.** It only covers Privy users.
- **SEP-10 style challenge.** Every wallet can sign a transaction, Privy included, and it is
  Stellar's standard for proving control of an account.

## Decision

- `api/auth.js` replaces `nonce.js`, so the number of functions stays the same.
- The server builds the challenge with the Stellar SDK's `WebAuth.buildChallengeTx`:
  - the source account is the server's own;
  - the sequence number is 0;
  - it has a `manageData` operation with 48 random bytes;
  - it is valid for 5 minutes;
  - the server signs it with `AUTH_SIGNING_SECRET`.
- The challenge is never submitted to the network. That signing key belongs to an account with
  no funds, so leaking it moves no money.
- The wallet signs the challenge, and `verify` checks it with `readChallengeTx` and
  `verifyChallengeTxSigners`. It accepts the signature of the account's master key, which
  also works for accounts that do not exist on-chain yet.
- The challenge's hash is recorded with `consume_auth_challenge`, so it works only once. The
  hash does not change when signatures are added or removed.
- The session is an HS256 JWT signed with `AUTH_JWT_SECRET`. It lasts 60 minutes and is stored
  in an `HttpOnly; Secure; SameSite=Strict` cookie limited to `/api`. No session store is needed.
- The frontend asks for the signature just before an action that needs it
  (`ensureApiSession` in `src/lib/apiSession.ts`), not at sign-in. Opening the app never shows
  a signing popup. The signing function is passed in, so the module imports neither Privy nor
  the wallet kit (ADR-001).
- Endpoints that act for a wallet take the address from the session. `evaluate-and-mint`
  answers `401` without a session and `403` if the body names another wallet. The money
  endpoints follow in the next PR (#94).

## Consequences

- Minting a tier needs one extra signature per hour. Wallets show it as a transaction: it
  should say it is not submitted.
- **Not supported:** accounts whose master key has no weight (multisig with a disabled master
  key), and muxed `M…` addresses.
- Without `AUTH_SIGNING_SECRET`, `AUTH_JWT_SECRET` or Supabase, the auth endpoints answer
  `503` and nobody can mint.
- **Rotating secrets:** a new `AUTH_JWT_SECRET` signs everyone out. A new
  `AUTH_SIGNING_SECRET` only invalidates challenges that are still open.

## Related

- [API](../api.md#apiauth) · [Supabase](../integrations/supabase.md) ·
  [ADR-001](ADR-001-lazy-privy.md) · [ADR-007](ADR-007-supabase-fail-closed.md)
