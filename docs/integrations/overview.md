---
tags: [integration, index]
updated: 2026-10-22
---

# Integrations overview

Every external service Vyn talks to, in one table. Each name links to its note with the
calls, variables, data and failure modes. Everything runs on **testnet / sandbox**.

| Integration | Used for | Called from | Variables | If it fails |
|---|---|---|---|---|
| [Soroban RPC](soroban-rpc.md) | Read and write the three contracts | `src/stellar/*`, `CreditSection`, `Retiros`, `Tesoreria`, `api/*` | Contract IDs, `SECRET_KEY_ADMIN` | Balances read as 0, score 0 or `500`, credit shows tier 0 |
| [Horizon and Friendbot](horizon.md) | Accounts, trustlines, history, classic payments; funding new testnet accounts | `trustline.ts`, `activity.ts`, `PrivyBridge`, `api/_usdc.mjs` | — | Empty history, trustline and faucet fail |
| [DeFindex](defindex.md) | Real yield on USDC savings | `staking_pool` contract, `scripts/*` | Contract IDs; script-only admin keys | No yield while the keeper is off; withdrawals depend on the vault |
| [Privy](privy.md) | Email / Google / passkey login with an embedded Stellar wallet | `PrivyGate`, `PrivyLayer`, `PrivyBridge`, `privyBridge.ts` | `VITE_PRIVY_APP_ID` | Email users can't sign in or sign |
| [Stellar Wallets Kit](stellar-wallets-kit.md) | Freighter, Albedo, xBull, LOBSTR, Hana, Rabet, WalletConnect | `stellarWalletsKit.ts`, `mobileWalletConnectors.ts` | `VITE_WALLETCONNECT_PROJECT_ID` (optional) | Wallet users can't connect or sign |
| [BlindPay](blindpay.md) | SPEI on-ramp (MXN → USDC) and off-ramp (USDC → MXN) | `Depositar`, `Retiros`, `Login`, `api/onramp.js`, `api/blindpay.js` | `BLINDPAY_*`, `SECRET_KEY_ADMIN` | `502` with BlindPay's message; funds may be half-moved |
| [Supabase](supabase.md) | Wallet ↔ BlindPay mapping, faucet dedup, settlement idempotency | `api/_supabase.mjs` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_KEY` | On-ramp `502`; faucet fails open; readiness `503` |
| [USDC faucet](usdc-faucet.md) | 2 test USDC per new wallet | Perfil, `api/faucet-usdc.js` | `SECRET_KEY_ADMIN`, `FAUCET_USDC_AMOUNT` | `502` (e.g. admin out of USDC) |
| [Vercel](vercel.md) | Hosting, 10 API functions (Hobby limit 12) | `vercel.json`, `api/` | All server variables | Build fails above 12 functions |
| [WebSocket](websocket.md) | Event replay hub | — (not connected) | `MAX_REPLAY_EVENTS` | — |
| [Other services](other-services.md) | StellarExpert links, SBT metadata on GitHub, Google Fonts, Lovable (dev) | Several | — | Broken links or metadata only |
| GitHub Actions | Contracts CI; Supabase keep-alive every 6 h | `.github/workflows/` | `KEEPALIVE_BASE_URL` (optional repo variable) | Red check / email |

## Secrets and keys at a glance

| Key | Lives in | Can move funds? |
|---|---|---|
| `SECRET_KEY_ADMIN` | Vercel (server) | Yes: mints SBTs, pays the faucet and on-ramp settlements. Also the admin of the contracts and the DeFindex vault (via scripts). |
| `BLINDPAY_PAYOUT_SECRET` | Vercel (server) | Yes: signs every SPEI payout from the payout wallet. |
| `BLINDPAY_API_KEY` | Vercel (server) | Yes, through BlindPay. |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (server) | Indirectly: deleting settlement rows would allow paying twice. |
| `VITE_*` | Browser bundle | No (public by design). |

Never commit any of them; `.env*` files stay local and `.env.example` lists names only.

## Also read

- [Pending and half-finished integrations](pending.md)
- [SPEI testing](../spei-testing.md)
- [Architecture](../architecture.md) · [API reference](../api.md) · [Deployment](../deployment.md)
