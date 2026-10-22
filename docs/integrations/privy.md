---
tags: [integration, privy, auth, wallet]
updated: 2026-10-22
prs: [130, 132, 133, 134, 135, 136, 137]
files:
  - src/components/PrivyGate.tsx
  - src/components/PrivyLayer.tsx
  - src/components/PrivyBridge.tsx
  - src/lib/privyBridge.ts
  - src/lib/privyWallets.ts
  - src/pages/Login.tsx
  - src/pages/Perfil.tsx
  - src/lib/mobileWalletConnectors.ts
  - e2e/mocks/privy.tsx
  - e2e/mocks/privy-extended.ts
---

# Privy

[Privy](https://www.privy.io/) gives users without a Stellar wallet a way in: they sign in
with **email, Google or a passkey**, and Privy creates an **embedded Stellar wallet** for
them. The app then signs transactions with that wallet. Package: `@privy-io/react-auth`
(including `extended-chains` for Stellar).

Two decision records cover the important rules:
[ADR-001](../decisions/ADR-001-lazy-privy.md) (load Privy only when needed) and
[ADR-002](../decisions/ADR-002-oldest-privy-wallet.md) (always use the oldest wallet).

## How it is wired

```
App ─ PrivyGate ─(lazy)─▶ PrivyLayer = <PrivyProvider> + <PrivyBridge/>
                                                 │ registers signer, actions, state
App code ──────────────────────────────▶ src/lib/privyBridge.ts (no Privy import)
```

- `PrivyGate` mounts the layer on `/login` (without a complete session), for a Privy session
  (`vinculo_wallet_provider === "privy"`), or when code calls the bridge. It starts the
  download at startup if the saved session is Privy or there is no session.
- `PrivyLayer` configures `loginMethods: ["email", "google", "passkey"]` and the light theme.
- `PrivyBridge` (invisible) does the work inside the provider:
  1. finds the oldest Stellar wallet of the user, or creates one with
     `createWallet({ chainType: "stellar" })` through `createStellarWalletOnce`;
  2. funds it on testnet with Friendbot if Horizon returns `404`;
  3. registers the **signer**: it hashes the transaction (`tx.hash()`), signs the hash with
     `useSignRawHash` (Ed25519), **verifies the signature locally** with the wallet's public
     key, and attaches it with `tx.addSignature`;
  4. publishes state (`ready`, `authenticated`, `email`, `passkeys`, `googleLinked`) and the
     actions `login`, `logout`, `exportWallet`, `linkPasskey`, `linkGoogle`;
  5. emits the "connected" event that `Login` uses to open the app session.
- App code only uses `privyBridge`: `usePrivyBridge()`, `privyLogin()`, `privyLogout()`,
  `privySign(xdr)`, `privyExportWallet(address)`, `privyLinkPasskey()`, `privyLinkGoogle()`.
  Actions queue or wait up to 20 s (`PRIVY_WAIT_MS`) until the SDK is ready.

Signing a transaction for a Privy session goes through `signTransactionXdr`
(`src/lib/mobileWalletConnectors.ts`), which calls `privySign` when the provider is
`"privy"` and the wallet kit otherwise.

## Where it is used

| Screen | Use |
|---|---|
| `/login` | "Entrar con correo" opens the Privy modal. On connect, the app session is saved with provider `privy` and `POST /api/onramp?action=init` registers the wallet with BlindPay (fire and forget). |
| Perfil → "Métodos de acceso" | Add a passkey; link Google to the email account (hidden once linked). |
| Perfil → "Abrir wallet" | `privyExportWallet` opens Privy's panel to view or export the key. |
| Any signature | Deposits, withdrawals, trustline, loans, SPEI on-ramp deposit. |
| Logout | `WalletSessionContext.disconnect` calls `privyLogout()` so Privy does not log the user back in. |

## Environment variables

| Variable | Notes |
|---|---|
| `VITE_PRIVY_APP_ID` | Privy app ID, public (baked into the bundle). **Missing from `.env.example`.** E2E sets it to `e2e-stub`. |

Dashboard settings the code depends on (not in the repo): email, Google and passkey login
enabled; "Enable passkeys for sign up" off (a passkey is added later from Perfil, so the
account can always be recovered by email); Stellar embedded wallets enabled; the production
domain and its OAuth redirect allowed. `vercel.json` and `vite.config.ts` send
`Cross-Origin-Opener-Policy: same-origin-allow-popups` so OAuth popups can post back.

## Data in and out

- In: the user's email (shown in Perfil and sent to BlindPay as the wallet's display name),
  linked accounts, the Stellar address.
- Out: signed transaction XDRs. The private key never leaves Privy.
- The backend never verifies a Privy session or token. API endpoints trust the wallet
  address sent in the request body.

## Failure modes

| Failure | Behavior |
|---|---|
| SDK not ready in 20 s | `privySign` / export / link reject with "Privy no está listo…". |
| Google or another method rejected by Privy (domain, redirect, method disabled) | The modal's promise rejection is caught in `PrivyBridge` and shown as a toast on `/login` (`loginError`). |
| Linking Google that is already another Privy user | `linkError` with code `linked_to_another_user`; that user must be deleted in the Privy dashboard first (ADR-002). |
| Signature does not verify locally | Throws before sending, instead of a `tx_bad_auth` from the network. |
| Two wallets on one account | The oldest is used (`firstVerifiedAt`, then `walletIndex`, then address). |
| New wallet without XLM | Friendbot funds it in the background; on mainnet this would need a sponsor. |

## Tests

- Unit: `src/lib/privyBridge.test.ts`, `src/lib/privyWallets.test.ts`.
- E2E: `VITE_E2E=1` aliases `@privy-io/react-auth` and its `extended-chains` entry to
  `e2e/mocks/`, so Playwright runs without a real app ID (`e2e/privy-lazy.spec.ts` checks the
  lazy loading).

## Related

- [Stellar Wallets Kit](stellar-wallets-kit.md) · [Horizon and Friendbot](horizon.md) ·
  [BlindPay / SPEI](blindpay.md)
