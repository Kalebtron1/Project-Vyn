---
tags: [api]
updated: 2026-10-22
files:
  - api/
  - api/validation.mjs
  - backend/server.js
---

# API reference

Vercel Node functions in `api/`, served from the same domain as the app
(`https://www.projectvyn.dev/api/...`). All bodies are JSON. Validation errors from
`api/validation.mjs` (zod) answer `400` with `{ "error": "<field>: <message>", "status": "error" }`.

- **Auth:** a wallet session cookie from [`/api/auth`](#apiauth)
  ([ADR-008](decisions/ADR-008-wallet-session.md)). Everything that moves money or spends
  the admin key requires it: `evaluate-and-mint`, `onramp` `payin` and `settle`, `blindpay`
  `payout` and `faucet-usdc`. The address in the body must be the session's, or the answer is
  `401` `{ reason: "no_session" }` or `403` `{ reason: "address_mismatch" }`. Reads
  (`quote`, `status`, score, credit) do not need it.
- **CORS:** `api/_cors.mjs` echoes the `Origin` only when it is allowed: `ALLOWED_ORIGINS`,
  the deployment's own Vercel domains and, outside production, `localhost`. Other origins
  get no CORS headers. `OPTIONS` answers `204`. The app calls the API from its own domain,
  which needs no CORS. `/api/health` and `/api/readiness` send no CORS headers.
- **Logs:** one JSON line per event (`ts`, `level`, `reqId`, `event`, …) from
  `api/_logger.mjs`, plus `[metric]` lines for latency.
- **Local:** `backend/server.js` serves the API on port 3000. `/api/auth`,
  `/api/evaluate-and-mint`, `/api/onramp`, `/api/blindpay` and `/api/faucet-usdc` use the real
  handlers; the other routes are older copies.

| Endpoint | Method | Used by |
|---|---|---|
| [`/api/calculate-score`](#post-apicalculate-score) | POST | `useScore`, Perfil, `evaluate-and-mint` |
| [`/api/evaluate-and-mint`](#post-apievaluate-and-mint) | POST | Perfil |
| [`/api/get-available-credit`](#post-apiget-available-credit) | POST | `useCredit`, Perfil |
| [`/api/faucet-usdc`](#post-apifaucet-usdc) | POST | Perfil |
| [`/api/onramp`](#apionramp) | GET, POST | Depositar, Login |
| [`/api/blindpay`](#apiblindpay) | GET, POST | Retiros |
| [`/api/health`](#get-apihealth-and-get-apireadiness) | GET | Deploy checks |
| [`/api/readiness`](#get-apihealth-and-get-apireadiness) | GET | Keep-alive workflow, deploy checks |
| [`/api/auth`](#apiauth) | GET, POST | `ensureApiSession` (Perfil, before minting) |

---

## POST /api/calculate-score

Score and tier from the user's counters in `staking_pool` (not from Horizon).

**Request:** `{ "address": "G..." }`. A `totalDeposited` field is accepted (number ≥ 0) and
ignored.

**Response 200 (eligible)**

```json
{
  "score": 60.21,
  "tier": 1,
  "tierName": "Plata",
  "eligibility": { "minHistoryRequired": 3, "historyCount": 3, "isHistoryEligible": true, "remainingForUnlock": 0 },
  "metrics": { "retention": 1, "activity": 0.6, "volumeIn": 25, "volumeOut": 0 }
}
```

With fewer than 3 transactions: `score: 0`, `tier: 0`, `isHistoryEligible: false`,
`remainingForUnlock` = missing count, and no `metrics`. `anomaly: true` is added if the score
exceeds 2 000 or retention 5 (not reachable with the current capped formula).

| Status | Body | Reason |
|---|---|---|
| 400 | `{ "error": "address: Required", "status": "error" }` (or `address: es requerido` when empty) | Missing or empty `address` |
| 405 | `{ "error": "Method not allowed" }` | Not POST |
| 500 | `{ "error": "STAKING_CONTRACT_ID no configurado" }` | Missing variable |
| 500 | `{ "error": "<message>" }` | A simulation failed |

An address that doesn't exist on-chain (or an RPC failure at `getAccount`) returns score 0
with `200`. `maxDuration` is 60 s.

## POST /api/evaluate-and-mint

Recomputes the score through `/api/calculate-score` and mints that tier on `vinculo_sbt`,
signed by `SECRET_KEY_ADMIN`. **Requires a wallet session** for `userAddress`: `401`
`{ reason: "no_session" }` without one, `403` `{ reason: "address_mismatch" }` if the session
belongs to another wallet, `503` if the session is not configured.

**Request**

```json
{ "userAddress": "G...", "totalVolume": 25, "deposits": [{ "amount": 25 }] }
```

`totalVolume` and `deposits` are optional and do not change the tier (the score endpoint
reads the contract).

| Status | Body | When |
|---|---|---|
| 200 | `{ "status": "minted", "txHash": "…", "tier": 1, "tierName": "Plata" }` | Tier ≥ 1 and the transaction succeeded (polled up to 45 s) |
| 200 | `{ "status": "pending", "message": "Nivel insuficiente", "tier": 0, "tierName": "Bronce" }` | Tier 0 |
| 422 | `{ "status": "anomaly", "tier", "tierName", "message" }` | Score flagged as anomalous |
| 400 | validation error | Missing `userAddress` |
| 500 | `{ "error": "Falta la variable de entorno STAKING_CONTRACT_ID" }` | Missing variable |
| 500 | `{ "status": "error", "message": "…" }` | Score request failed |
| 500 | `{ "status": "error", "tier", "tierName", "message": "…" }` | Mint failed: rejected, reverted, not confirmed in time, or the user already has that exact tier (contract panic) |

The contract accepts a lower tier than the current one; only the same tier is rejected.
`maxDuration` is 60 s.

## POST /api/get-available-credit

**Request:** `{ "userAddress": "G..." }`

**Response 200**

```json
{ "success": true, "tier": 2, "tierName": "Oro", "availableCredit": 600, "currency": "XLM" }
```

| Tier | Name | Credit (XLM) |
|---|---|---|
| 0 | Bronce | 0 |
| 1 | Plata | 300 |
| 2 | Oro | 600 |
| 3 | Diamante | 1 500 |
| 4 | Platino | 5 000 |

It simulates `get_tier` with the user's own account as the source, so it needs no admin
key. On a contract, RPC or configuration error it answers `502` `{ error }`, so an outage does
not look like "no credit". `400` for a missing `userAddress`, `405` if not POST.

## POST /api/faucet-usdc

**Request:** `{ "address": "G..." }` (needs a USDC trustline).

| Status | Body |
|---|---|
| 200 | `{ "sent": true, "hash": "…", "amount": "2" }` |
| 200 | `{ "sent": false, "reason": "already_claimed" }` or `{ "sent": false, "reason": "no_trustline" }` |
| 400 | `{ "error": "address inválida (dirección Stellar G…)" }` |
| 405 | `{ "error": "Método no permitido" }` |
| 409 | `{ "sent": false, "reason": "in_review" }`: the send may have gone through and needs a manual review |
| 429 | `{ "sent": false, "reason": "ip_cap" }` or `{ "sent": false, "reason": "global_cap" }` |
| 502 | `{ "error": "…" }` (e.g. `Horizon: {...op_underfunded...}`) |
| 503 | `{ "error": "…" }`: Supabase failed or the faucet is not configured. No funds moved |

See [USDC faucet](integrations/usdc-faucet.md).

## /api/onramp

SPEI → USDC. Select the operation with `?action=`. Amounts in MXN; BlindPay requires at
least 10 USD, and the API rejects less than 175 MXN. See [BlindPay](integrations/blindpay.md).

| Action | Method | Body / query | Response 200 |
|---|---|---|---|
| `init` | POST | `{ walletAddress, email? }` | `{ receiverId, blockchainWalletId, reused }` |
| `quote` | POST | `{ walletAddress, amountMxn, email? }` | `{ quoteId, senderMxn, receiverUsd, flatFeeUsd, partnerFeeUsd, rateMxnPerUsd, commercialRateMxnPerUsd, expiresAt }` |
| `payin` | POST | same as `quote` | `{ payinId, status, clabe, senderMxn, receiverUsd, address, network, tracking, payment, txHash, quote: {…} }` |
| `status` | GET | `&id=<payinId>` | Same fields as `payin` without `quote` |
| `settle` | POST | `{ payinId, walletAddress }` | `{ settled: true, to, amountUsd, hash }`, or `{ settled: false, reason: "not_paid", status }`, or `{ settled: false, reason: "already_settled", hash }` |

`settle` answers these with `{ settled: false, reason }`:

| Status | `reason` | Meaning |
|---|---|---|
| `403` | `forbidden` | The payin belongs to another wallet. |
| `404` | `unknown_payin` | The payin is not in `ramp_payins`, so it was not created by this API. |
| `409` | `payin_mismatch` | BlindPay reports another address or no valid amount. |
| `409` | `in_review` | A reservation is in progress or never finished. It needs a manual review. |
| `429` | `payin_cap`, `wallet_cap`, `global_cap` | Over a limit. See [BlindPay](integrations/blindpay.md#limits). |

`quote` and `payin` answer `400` with `{ reason: "payin_cap", maxUsd }` over the per-payin limit.

Other errors: `400` for an unknown action or validation; `405` for the wrong method; `503`
with `{ error }` if Supabase fails, with no funds moved; `502` with `{ error }` for BlindPay or
Horizon failures.

## /api/blindpay

USDC → SPEI. Amounts in USD (USDC), at least 10.

| Action | Method | Body / query | Response 200 |
|---|---|---|---|
| `quote` | POST | `{ amount }` | `{ quoteId, senderUsd, receiverMxn, flatFeeUsd, partnerFeeUsd, rateMxnPerUsd, commercialRateMxnPerUsd, expiresAt, fundingAddress }` |
| `payout` | POST | `{ amount, walletAddress, fundingTxHash }` | `{ payoutId, status, quote: {…}, tracking, payment }` |
| `status` | GET | `&id=<payoutId>` | `{ payoutId, status, tracking, payment }` |

Before `payout`, the user pays `amount` USDC from `walletAddress` to `fundingAddress` in a
single-payment transaction, and sends its hash as `fundingTxHash`. `payout` rejects it with
`{ reason }`:

| Status | `reason` | Meaning |
|---|---|---|
| `404` | `funding_not_found` | Horizon does not have the transaction (yet). |
| `400` | `funding_failed` | The transaction failed. |
| `400` | `funding_expired` | It is older than 15 minutes. |
| `400` | `funding_invalid` | It is not exactly one USDC payment to `fundingAddress`. |
| `400` | `funding_insufficient` | It pays less than `amount`. |
| `403` | `funding_wrong_sender` | It was not sent by `walletAddress`. |
| `409` | `funding_already_used` | That hash already backs a payout. |

Other errors: `400` for an unknown action or validation; `405` for the wrong method; `500`
`{ "error": "BlindPay demo no configurado" }` without `BLINDPAY_DEMO_BANK_ACCOUNT_ID`; `503`
without `OFFRAMP_FUNDING_ADDRESS` or if Supabase fails, with no payout; `502` with
BlindPay's message.

## GET /api/health and GET /api/readiness

```json
{ "status": "ok", "endpoint": "/api/health", "timestamp": "2026-10-22T05:48:43.751Z" }
```

```json
{ "status": "ready", "endpoint": "/api/readiness", "timestamp": "…", "checks": { "supabase": "ok" } }
```

- `health` never touches a dependency.
- `readiness` reads one row from Supabase (5 s timeout). `checks.supabase` is `"ok"`,
  `"not_configured"` (still `200`) or `"error"` (`503`, `status: "not_ready"`). The
  `supabase-keepalive` workflow calls it every 6 hours
  ([Supabase](integrations/supabase.md#keeping-the-project-awake)).
- Any other method: `405` with an `Allow: GET` header.

## /api/auth

Wallet session ([ADR-008](decisions/ADR-008-wallet-session.md)). Select the operation with
`?action=`.

| Action | Method | Body | Response 200 |
|---|---|---|---|
| `challenge` | POST | `{ address }` | `{ transaction, networkPassphrase }`: a challenge signed by the server, to sign and send back. Never submitted to the network. |
| `verify` | POST | `{ transaction }` (signed by the wallet) | `{ address, expiresAt }` and the `vyn_session` cookie (`HttpOnly; Secure; SameSite=Strict; Path=/api`, 60 min) |
| `session` | GET | | `{ address, expiresAt }`, or `401` without a valid session |
| `logout` | POST | | `{ ok: true }` and clears the cookie |

Errors:

| Status | When |
|---|---|
| `400` | Invalid address on `challenge`, or missing `transaction` on `verify`. |
| `401` | `verify` with a challenge that is expired, already used, made by another server key or for another domain, or not signed by the address. |
| `503` | `AUTH_SIGNING_SECRET` or `AUTH_JWT_SECRET` is missing, or Supabase fails. No session is issued. |
