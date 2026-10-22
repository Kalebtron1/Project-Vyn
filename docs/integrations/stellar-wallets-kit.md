---
tags: [integration, wallet, stellar-wallets-kit, walletconnect]
updated: 2026-10-22
prs: [55, 80, 82, 109]
files:
  - src/lib/stellarWalletsKit.ts
  - src/lib/mobileWalletConnectors.ts
  - src/lib/walletEnv.ts
  - src/lib/sessionStore.ts
  - src/wallet/StellarWalletAdapter.ts
  - src/hooks/useMobileWallet.ts
  - src/hooks/useWallet.tsx
  - src/context/WalletSessionContext.tsx
  - src/components/WalletSetupModal.tsx
---

# Stellar Wallets Kit (and Freighter, WalletConnect)

[Stellar Wallets Kit](https://github.com/Creit-Tech/Stellar-Wallets-Kit) by Creit Tech
(`@creit.tech/stellar-wallets-kit` v2) gives one modal and one API to connect and sign with
several Stellar wallets. Users who sign in with email use [Privy](privy.md) instead.

## Modules registered

`getKit()` in `src/lib/stellarWalletsKit.ts` initializes the kit once (it is a static class)
on `Networks.TESTNET` with:

| Module | Wallet | Notes |
|---|---|---|
| `FreighterModule` | Freighter (extension) | Default selected wallet. |
| `AlbedoModule` | Albedo (web popup) | Works on mobile browsers. |
| `xBullModule` | xBull | |
| `LobstrModule` | LOBSTR (extension) | Desktop extension only; the mobile app can't sign through this flow. |
| `HanaModule` | Hana | |
| `RabetModule` | Rabet | |
| `WalletConnectModule` | Any WalletConnect wallet (QR / deep link) | Only if `VITE_WALLETCONNECT_PROJECT_ID` is set; chain `TESTNET`; metadata name "Vyn". |

## Flow

```
connectWallet() ─▶ kit.authModal() ─▶ { address, walletId }
     │ saveProvider(walletId) + session address (localStorage + 30-day cookie)
signTransactionXdr(xdr, provider)
     ├─ provider === "privy" ─▶ privySign(xdr)
     └─ kit.setWallet(provider); kit.signTransaction(xdr, { networkPassphrase, address })
```

- `src/lib/mobileWalletConnectors.ts` keeps the public API stable (`connectWallet`,
  `signTransactionXdr`, `getSavedProvider`, `saveProvider`) and maps errors that contain
  "reject", "declined", "cancel", "closed" or "dismiss" to a cancellation.
- `StellarWalletAdapter` (`src/wallet/`) and `useMobileWallet` are thin wrappers used by
  `CreditSection`, `DepositModal`, `Retiros`, `Tesoreria`, `Perfil` and `Depositar`.
- The session lives in `WalletSessionContext` with keys `vinculo_wallet`,
  `vinculo_wallet_provider` and `vinculo_onboarded`, mirrored to cookies by
  `src/lib/sessionStore.ts` so it survives flaky mobile storage.
- `src/lib/walletEnv.ts` holds `FREIGHTER_ID` and `isMobileBrowser` without importing the kit,
  so the root bundle stays small.

## Freighter API, used directly

Besides the kit, `@stellar/freighter-api` is called directly for things the kit doesn't do:

| Call | Where | Why |
|---|---|---|
| `getAddress()` every 1.5 s | `WalletSessionContext` (desktop + Freighter only) | Warn when the active Freighter account differs from the session (`walletMismatch`). |
| `isConnected()` every 1.5 s | `useWallet` (desktop + Freighter only) | Show "disconnected" if the extension is removed or locked. |
| `requestAccess()` | Perfil (before minting, and "Abrir wallet") | Confirm the same Freighter account; open the extension. |

These intervals check the extension, not the chain, so they are outside
[ADR-003](../decisions/ADR-003-no-polling-cache.md).

## Environment variables

| Variable | Notes |
|---|---|
| `VITE_WALLETCONNECT_PROJECT_ID` | Optional, public. Project ID from Reown Cloud (cloud.reown.com). Empty = no WalletConnect option. |

## Data in and out

- In: the public address and the chosen wallet ID. No secret keys ever reach the app.
- Out: unsigned XDRs to the wallet; signed XDRs back.

## Failure modes

| Failure | Behavior |
|---|---|
| User closes the modal or rejects | `{ ok: false, cancelled: true }` and a "Conexión/Firma cancelada" message. |
| Popup blocked (Albedo) | Message asking to allow popups. Perfil pre-funds the account in the background so the popup opens right after the click. |
| Wallet not installed | The kit shows the option as unavailable; `WalletSetupModal` on `/login` lists install links. |
| Freighter switched account | Banner from `walletMismatch`; deposits and loans also refuse a different address. |
| Wrong network in the wallet | The kit passes `Networks.TESTNET`; a wallet on mainnet fails to sign. |

## Notes

- `@albedo-link/intent` is still a dependency, but no file in `src/` imports it; the kit's
  Albedo module is used instead.
- `DepositModal` labels the provider "Albedo" or "Freighter" only, even when another kit
  wallet is in use.

## Related

- [Privy](privy.md) · [Soroban RPC](soroban-rpc.md) · [Architecture](../architecture.md)
