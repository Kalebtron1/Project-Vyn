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
         - listed in the old faucet_claims table?     → { sent: false, reason: "already_claimed" }
         - read the USDC trustline (3 retries, 1.5 s) → none: { sent: false, reason: "no_trustline" }
         - reserve_faucet: wallet, IP and daily budget → already_claimed, ip_cap or global_cap
         - classic payment admin → user, FAUCET_USDC_AMOUNT (default "2") USDC via Horizon
         - finish_faucet                              → { sent: true, hash, amount }
  5. toast "+2 USDC" or the reason; "Reintentar" only repeats step 4
```

## Endpoint

`POST /api/faucet-usdc` with `{ "address": "G…" }`.

| Status | Body |
|---|---|
| 200 | `{ sent: true, hash, amount }`, `{ sent: false, reason: "already_claimed" }` or `{ sent: false, reason: "no_trustline" }` |
| 400 | `{ error: "address inválida (dirección Stellar G…)" }` |
| 405 | Non-POST |
| 409 | `{ sent: false, reason: "in_review" }` |
| 429 | `{ sent: false, reason: "ip_cap" }` or `{ sent: false, reason: "global_cap" }` |
| 502 | `{ error }`, e.g. `Falta SECRET_KEY_ADMIN` or `Horizon: {"transaction":"tx_failed","operations":["op_underfunded"]}` |
| 503 | `{ error }`: Supabase failed or the faucet is not configured. No USDC is sent. |

## Environment variables

| Variable | Notes |
|---|---|
| `SECRET_KEY_ADMIN` | Signs the payment. The admin account needs a USDC trustline, a USDC balance (topped up by hand) and XLM for fees. |
| `FAUCET_USDC_AMOUNT` | Optional, default `"2"`. |
| `FAUCET_IP_SALT` | **Required.** Random secret mixed into the IP hash, because an unsalted IPv4 hash can be reversed by trying every address. Without it the faucet answers `503`. Changing it restarts the day's IP counts. |
| `FAUCET_IP_DAILY_MAX` | Optional, default `5` grants per IP per UTC day. |
| `FAUCET_DAILY_BUDGET_USD_CENTS` | Optional, default `5000` (50 USDC) overall per UTC day. |
| `SUPABASE_*` | Reservations and limits ([Supabase](supabase.md)). Required in every environment. |

The asset (code `USDC`, issuer starting with `GATALTGT`) is hard-coded in `api/_usdc.mjs` and
`src/stellar/trustline.ts`.

## Failure modes

| Failure | Behavior |
|---|---|
| Admin account out of USDC | `502` with `op_underfunded`; Perfil shows the reason and offers a retry. |
| Supabase down or not configured | **Fails closed**: no USDC is sent and the endpoint answers `503`, in every environment. |
| Send declared as failed | `502`. The wallet can try again and the budget is returned. |
| Send times out | `409 in_review`. The reservation stays closed until a manual review, and later claims answer `already_claimed`. |
| Grant not recorded after sending | `200` with the hash, logged. The reservation stays closed, so the wallet cannot claim again. |
| Trustline not yet visible | `no_trustline`; the user retries. Nothing is reserved. |

## Risks

- Anyone can create new testnet accounts (Friendbot) and claim from each one. The IP limit
  raises the cost but can be avoided with other IPs, and one IPv6 user may control many
  addresses. The daily budget is the hard limit on what can leave.
- There is no session yet, so anyone can claim for any address.
- The same admin key also mints SBTs and pays on-ramp settlements. Draining its USDC breaks
  the faucet and the SPEI on-ramp at the same time; leaking the key compromises all three.

## Related

- [Horizon and Friendbot](horizon.md) · [Supabase](supabase.md) · [BlindPay](blindpay.md)
