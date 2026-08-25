# Wallet Providers — Compatibility & Fallback Routing

This document describes which Stellar wallets are supported in Project Vyn, which
environments they work in, and the fallback order when a wallet is unavailable.

---

## Supported Wallet Providers

| Wallet | Desktop (browser extension) | Mobile (web) | Auth method | Kit module | Notes |
|--------|:---------------------------:|:------------:|-------------|------------|-------|
| **Freighter** | Yes | No | Browser extension | `FreighterModule` | Default on desktop. Requires the Freighter extension installed. |
| **Albedo** | Yes | Yes | Web popup / redirect | `AlbedoModule` | Primary fallback on mobile. Also available on desktop as a fallback. |
| **xBull** | Yes | No | Browser extension | `xBullModule` | Desktop only; user must install the xBull extension. |
| **Lobstr** | Yes | Yes | Web / app deep-link | `LobstrModule` | Works on both platforms via Stellar Wallets Kit. |
| **Hana** | Yes | No | Browser extension | `HanaModule` | Desktop only. |
| **Rabet** | Yes | No | Browser extension | `RabetModule` | Desktop only. |
| **Privy** | Yes | Yes | Email / Google / Apple login | N/A (Privy SDK) | Bypasses the wallet modal. Handled separately via `privyBridge.ts`. |

### Key

- **Desktop** = any non-mobile browser (Chrome, Firefox, Edge, etc.)
- **Mobile** = Android / iOS browser (detected via `isMobileBrowser()` in `mobileWalletConnectors.ts`)
- **Web popup / redirect** = wallet authorization happens in a popup or redirect, not via a browser extension

---

## Fallback Routing Order

When a user taps "Conectar wallet" the app opens the **Stellar Wallets Kit modal**
(`openWalletModal()` in `stellarWalletsKit.ts`). The modal shows all wallets whose
module is available in the current environment and lets the user choose.

If you need the programmatic fallback order (e.g., for automated tests or
headless flows), the order is:

1. **Privy session active?** → use Privy signer (`privySign` in `privyBridge.ts`).
2. **Stellar Wallets Kit modal** → user picks from available wallets.
3. **Saved provider** → on page reload, the kit restores the last-used wallet
   (`selectedWalletId` from `sessionStore`).
4. **Default** → Freighter (hardcoded fallback in `getSavedProvider()`).

### What happens when a provider is unavailable

| Scenario | Behaviour |
|----------|-----------|
| Freighter not installed on desktop | The Freighter entry in the modal may appear greyed-out or trigger a "not detected" warning. Albedo and other web-based wallets remain available. |
| No wallet extension on mobile | The modal shows mobile-compatible wallets (Albedo, Lobstr, etc.). Desktop-only extensions (Freighter, xBull, Hana, Rabet) are hidden or disabled. |
| User closes the modal without selecting | `connectWallet()` returns `{ ok: false, cancelled: true }`. The UI shows "Conexión cancelada. Puedes intentarlo de nuevo." |
| Privy signer not registered | If the user logged in via Privy but the bridge hasn't mounted, `privySign()` throws "Privy no está listo. Vuelve a iniciar sesión con tu correo." |

---

## Environment Detection

The app detects mobile vs. desktop via a user-agent check:

```ts
// src/lib/mobileWalletConnectors.ts
export function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(
    navigator.userAgent
  );
}
```

Stellar Wallets Kit internally uses this (and similar heuristics) to decide which
wallet modules to show in the modal.

---

## Provider Persistence

| Storage key | Purpose |
|-------------|---------|
| `vinculo_wallet` | The connected Stellar public key |
| `vinculo_wallet_provider` | The wallet ID used for the current session (e.g., `"freighter"`, `"albedo"`, `"privy"`) |
| `vinculo_onboarded` | Whether the user has completed the onboarding flow |

On reconnect, the kit restores `vinculo_wallet_provider` so the user doesn't have
to re-select their wallet.

---

## Architecture Overview

```
User clicks "Connect"
        │
        ▼
┌─────────────────────────┐
│  Privy session active?  │──yes──▶ privySign() ──▶ signed XDR
└─────────┬───────────────┘
          │ no
          ▼
┌─────────────────────────┐
│  openWalletModal()      │  ← Stellar Wallets Kit shows modal
│  (kit.authModal())      │
└─────────┬───────────────┘
          │ user picks wallet
          ▼
┌─────────────────────────┐
│  saveProvider(walletId)  │  ← persisted to session storage
│  saveAddress(address)   │
└─────────────────────────┘
```

For signing:

```
App needs to sign XDR
        │
        ▼
┌─────────────────────────┐
│  provider === "privy"?  │──yes──▶ privySign(xdr)
└─────────┬───────────────┘
          │ no
          ▼
┌─────────────────────────┐
│  kit.setWallet(id)      │
│  kit.signTransaction()  │  ← delegates to the chosen wallet module
└─────────────────────────┘
```

---

## Unsupported Combinations

The following combinations are **not** supported and should not be tested:

- Freighter on mobile (Freighter is a desktop-only browser extension)
- xBull on mobile (desktop-only extension)
- Hana on mobile (desktop-only extension)
- Rabet on mobile (desktop-only extension)
- Privy without internet (requires Privy backend for auth)

---

## Adding a New Wallet

To add a new wallet provider:

1. Install the wallet's Stellar Wallets Kit module (if one exists).
2. Add the module to the `modules` array in `src/lib/stellarWalletsKit.ts`.
3. No changes needed to `mobileWalletConnectors.ts` — the kit handles
   connection and signing automatically.
4. Update this document and the compatibility matrix above.

If the wallet does not have a Kit module, you can create a custom module
implementing the `StellarWalletsModule` interface from
`@creit.tech/stellar-wallets-kit`.

---

## Related Files

| File | Purpose |
|------|---------|
| `src/lib/stellarWalletsKit.ts` | Kit initialization and modal opener |
| `src/lib/mobileWalletConnectors.ts` | Unified connect/sign API over the kit |
| `src/lib/privyBridge.ts` | Privy (email login) signer bridge |
| `src/wallet/index.ts` | Singleton `walletAdapter` export |
| `src/wallet/StellarWalletAdapter.ts` | Default adapter delegating to the kit |
| `src/wallet/FreighterAdapter.ts` | Legacy Freighter-only adapter (kept for back-compat) |
| `src/wallet/WalletAdapter.ts` | Adapter interface contract |
