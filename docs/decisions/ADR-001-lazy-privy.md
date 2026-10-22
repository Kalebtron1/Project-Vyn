---
tags: [adr, privy, auth, performance]
status: accepted
date: 2026-10-21
issues: [108, 131]
prs: [130, 132, 133, 134, 135, 136]
files:
  - src/components/PrivyGate.tsx
  - src/components/PrivyLayer.tsx
  - src/components/PrivyBridge.tsx
  - src/lib/privyBridge.ts
  - vite.config.ts
---

# ADR-001: Load Privy only when needed

## Context

Privy (`@privy-io/react-auth`) and its dependencies weigh about 2 MB. `PrivyProvider`
wrapped the whole app, so every visitor downloaded it, including Freighter and other wallet
users who never use email login. The initial load was about 1,130 kB gzipped.

## Decision

- Routes are lazy-loaded with `React.lazy`.
- `PrivyGate` mounts `PrivyLayer` (the `PrivyProvider` plus `PrivyBridge`) **next to** the
  routes, not around them, and only:
  - on `/login` when there is no complete session,
  - for a Privy session (`vinculo_wallet_provider === "privy"`),
  - or when code calls into the bridge.
  Once mounted it stays mounted.
- App code talks to Privy only through `src/lib/privyBridge.ts`:
  - State: `usePrivyBridge()` (`ready`, `authenticated`, `email`, `passkeys`,
    `googleLinked`, `loginError`, `linkError`).
  - Actions: `privyLogin`, `privyLogout`, `privySign`, `privyExportWallet`,
    `privyLinkPasskey`, `privyLinkGoogle`.
  The actions queue or wait until Privy is ready, so callers don't care whether it loaded.
- `vite.config.ts` puts only React in a manual chunk. Putting Privy in a manual chunk makes
  Vite preload it and undoes the lazy loading (this is what went wrong in PR #127).

Login methods are `email`, `google` and `passkey`. Apple was removed. Passkey and Google
can be linked to an email account from Perfil ("Métodos de acceso").

## Consequences

- Initial load: 1,130 kB → 135 kB gzipped. Freighter home: 1,105 kB → 537 kB.
- **Never import `@privy-io/*` outside `PrivyLayer.tsx` and `PrivyBridge.tsx`.** One import
  elsewhere brings the 2 MB back into every page.
- Privy OAuth (Google) redirects the full page and returns with `?privy_oauth_code`, so
  `/login` must mount the layer on return. Errors from Privy's modal buttons are unhandled
  rejections; `PrivyBridge` catches them and reports them through `loginError` /
  `linkError`.
- E2E tests replace Privy with stubs in `e2e/mocks/` through aliases enabled by
  `VITE_E2E=1`.
