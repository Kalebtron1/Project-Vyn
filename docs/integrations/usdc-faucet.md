---
tags: [integration, faucet, usdc, testnet]
updated: 2026-10-22
issues: [93]
files:
  - api/faucet-usdc.js
  - api/_faucet-core.mjs
  - api/_usdc.mjs
  - api/_supabase.mjs
  - src/pages/Perfil.tsx
  - src/stellar/trustline.ts
---

# USDC faucet (testnet)

Gives each new wallet a small amount of the project's test USDC so it can try a deposit
without going through SPEI. It is Vyn's own faucet, not a public one: the USDC comes from
the project's **admin account**.

## Flow

```
Perfil → "Activar USDC"
  1. ensureTestnetAccount (Friendbot if the account doesn't exist)
  2. changeTrust(USDC) built in the browser, signed by the user, sent to Horizon
  3. wait until Horizon shows the trustline (up to 5 × 1.5 s)
  4. POST /api/faucet-usdc { address }
       sendFaucetUsdc:
         - already claimed? (Supabase faucet_claims)  → { sent: false, reason: "already_claimed" }
         - read the USDC trustline (3 retries, 1.5 s) → none: { sent: false, reason: "no_trustline" }
         - classic payment admin → user, FAUCET_USDC_AMOUNT (default "2") USDC via Horizon
         - record the claim (best effort)            → { sent: true, hash, amount }
  5. toast "+2 USDC" or the reason; "Reintentar" only repeats step 4
```

## Endpoint

`POST /api/faucet-usdc` with `{ "address": "G…" }`.

| Status | Body |
|---|---|
| 200 | `{ sent: true, hash, amount }`, `{ sent: false, reason: "already_claimed" }` or `{ sent: false, reason: "no_trustline" }` |
| 400 | `{ error: "address inválida (dirección Stellar G…)" }` |
| 405 | Non-POST |
| 502 | `{ error }`, e.g. `Falta SECRET_KEY_ADMIN` or `Horizon: {"transaction":"tx_failed","operations":["op_underfunded"]}` |

## Environment variables

| Variable | Notes |
|---|---|
| `SECRET_KEY_ADMIN` | Signs the payment. The admin account needs a USDC trustline, a USDC balance (topped up by hand) and XLM for fees. |
| `FAUCET_USDC_AMOUNT` | Optional, default `"2"`. Not in `.env.example`. |
| `SUPABASE_*` | Dedup store ([Supabase](supabase.md)). |

The asset (code `USDC`, issuer starting with `GATALTGT`) is hard-coded in `api/_usdc.mjs` and
`src/stellar/trustline.ts`.

## Failure modes

| Failure | Behavior |
|---|---|
| Admin account out of USDC | `502` with `op_underfunded`; Perfil shows the reason and offers a retry. |
| Supabase down or not configured | **Fails open**: the claim check is skipped and USDC is sent anyway. Without Supabase on Vercel, the "once per wallet" rule only holds within one warm function instance. |
| Claim not recorded after sending | The same wallet can claim again. |
| Trustline not yet visible | `no_trustline`; the user retries. |

## Risks

- Anyone can create new testnet accounts (Friendbot) and claim from each one; there is no
  rate limit per IP or per day (issue #93; PR #122 was closed without merging).
- The same admin key also mints SBTs and pays on-ramp settlements. Draining its USDC breaks
  the faucet and the SPEI on-ramp at the same time; leaking the key compromises all three.

## Related

- [Horizon and Friendbot](horizon.md) · [Supabase](supabase.md) · [BlindPay](blindpay.md)
