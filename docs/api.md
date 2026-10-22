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

- **Auth:** none. No endpoint checks who is calling; addresses come from the request
  ([pending](integrations/pending.md)).
- **CORS:** `calculate-score`, `evaluate-and-mint`, `get-available-credit` and `nonce` send
  `Access-Control-Allow-Origin: *` and answer `OPTIONS` with `200` (issue #94). The others
  send no CORS headers, so only the app's own origin can call them from a browser.
- **Logs:** one JSON line per event (`ts`, `level`, `reqId`, `event`, …) from
  `api/_logger.mjs`, plus `[metric]` lines for latency.
- **Local:** `backend/server.js` mirrors most endpoints on port 3000, with older validation,
  and lacks `/api/blindpay`.

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
| [`/api/get-user-data`](#get-apiget-user-data-unused) | GET | Nobody |
| [`/api/nonce`](#post-apinonce-unused) | POST | Nobody |

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
signed by `SECRET_KEY_ADMIN`. **No nonce or signature is required** (issues #89, #90).

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

On any contract, RPC or configuration error it still answers `200` with tier 0 and 0 credit
(issue #96). `400` for a missing `userAddress`, `405` if not POST.

## POST /api/faucet-usdc

**Request:** `{ "address": "G..." }` (needs a USDC trustline).

| Status | Body |
|---|---|
| 200 | `{ "sent": true, "hash": "…", "amount": "2" }` |
| 200 | `{ "sent": false, "reason": "already_claimed" }` or `{ "sent": false, "reason": "no_trustline" }` |
| 400 | `{ "error": "address inválida (dirección Stellar G…)" }` |
| 405 | `{ "error": "Método no permitido" }` |
| 502 | `{ "error": "…" }` (e.g. `Horizon: {...op_underfunded...}`) |

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
| `settle` | POST | `{ payinId, simulate? }` | `{ settled: true, to, amountUsd, hash, simulated }`, or `{ settled: false, reason: "not_paid", status }`, or `{ settled: false, reason: "already_settled" }` |

Errors: `400` for an unknown action, validation or a missing `payinId`; `405` for the wrong
method; `502` with `{ error }` for BlindPay, Supabase or Horizon failures.

`settle` with `simulate: true` pays an unpaid payin on testnet, and nothing checks the caller
(issue #92).

## /api/blindpay

USDC → SPEI. Amounts in USD (USDC), at least 10.

| Action | Method | Body / query | Response 200 |
|---|---|---|---|
| `quote` | POST | `{ amount }` | `{ quoteId, senderUsd, receiverMxn, flatFeeUsd, partnerFeeUsd, rateMxnPerUsd, commercialRateMxnPerUsd, expiresAt }` |
| `payout` | POST | `{ amount }` | `{ payoutId, status, quote: {…}, tracking, payment }` |
| `status` | GET | `&id=<payoutId>` | `{ payoutId, status, tracking, payment }` |

Errors: `400` for an unknown action or validation; `405` for the wrong method; `500`
`{ "error": "BlindPay demo no configurado" }` without `BLINDPAY_DEMO_BANK_ACCOUNT_ID`; `502`
with BlindPay's message.

`payout` sends from the backend payout wallet and does not check that the user withdrew from
the vault first (issue #91).

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

## GET /api/get-user-data (unused)

`?address=G...` → `{ "totalXlmDeposited", "currentPosition", "depositCount", "nftLevel" }`.
Despite the name, the amounts are in the pool's token (USDC), `depositCount` counts deposits
and withdrawals, and `nftLevel` is approximated from the position, not the score. An unknown
account returns zeros. `500` if `STAKING_CONTRACT_ID` is missing or the RPC fails. No caller.

## POST /api/nonce (unused)

`{ "address": "G..." }` → `{ "success": true, "nonce": "<hex>", "expires": <ms> }`. Kept in
the function's memory for 5 minutes, which doesn't survive between serverless invocations,
and no endpoint consumes it. No caller.
