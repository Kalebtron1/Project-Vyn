---
tags: [adr, privy, wallet]
status: accepted
date: 2026-10-21
prs: [137]
files:
  - src/lib/privyWallets.ts
  - src/components/PrivyBridge.tsx
---

# ADR-002: Use the oldest Stellar wallet of a Privy account

## Context

Users ended up with two embedded Stellar wallets in one Privy account, and the app switched
to the new, empty one. Two causes:

1. **Race on creation.** Two code paths could call `createWallet` at the same time on first
   login, so Privy created two wallets.
2. **Unstable order.** The code took the first Stellar wallet in `user.linkedAccounts`, but
   Privy does not guarantee that order.

Separately, Privy identifies users by login method, not by email. Logging in with Google
for the first time creates a **new** Privy user (with its own wallet) even if the same
email already has an account. The fix for that is linking, not merging.

## Decision

- `stellarWalletsOf` sorts by `firstVerifiedAt`, then `walletIndex`, then address.
- `primaryStellarWallet` is always the oldest one.
- `createStellarWalletOnce` shares one in-flight promise, so concurrent callers can't create
  two wallets.
- `signingWalletFor(ownWallets, source)` signs with the wallet that matches the transaction
  source, not just the first one.
- Google is linked to an existing email account from Perfil (`privyLinkGoogle`) instead of
  being used as a separate login.

## Consequences

- Accounts that already have two wallets go back to the original one (the one with funds).
- Don't change the selection to "first in the list" or "newest". Users would see a
  different, empty wallet.
- A Google account that was used to log in before linking is a separate Privy user. It has
  to be deleted in the Privy dashboard before it can be linked to the email account.
