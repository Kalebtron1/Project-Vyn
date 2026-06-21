# API Reference

All endpoints are Vercel Serverless Functions under `api/`. In production they are served from the same domain as the frontend. For local development, the Express server in `backend/server.js` mirrors every endpoint on `http://localhost:3000`.

All endpoints accept and return `application/json`. All `POST` endpoints handle `OPTIONS` preflight for CORS.

---

## POST /api/nonce

Issues a one-time nonce for a wallet address. The nonce must be included in the subsequent `/api/evaluate-and-mint` call and expires after 5 minutes.

**Request**

```json
{ "address": "G..." }
```

**Response 200**

```json
{
  "success": true,
  "nonce": "a3f8c2...",
  "expires": 1748725200000
}
```

**Error responses**

| Status | Body | Reason |
|---|---|---|
| 400 | `{ "error": "address required" }` | Missing `address` |
| 405 | `{ "error": "Method not allowed" }` | Non-POST request |

---

## POST /api/calculate-score

Computes a reputation score and tier for a wallet address using on-chain Horizon transaction history.

**Request**

```json
{
  "address": "G...",
  "totalDeposited": 1500.0
}
```

- `totalDeposited` — optional. Client-supplied XLM balance. Falls back to the live Horizon account balance if omitted or zero.

**Response 200**

```json
{
  "score": 87.45,
  "tier": 2,
  "tierName": "Oro",
  "eligibility": {
    "minHistoryRequired": 3,
    "historyCount": 5,
    "isHistoryEligible": true,
    "remainingForUnlock": 0
  },
  "metrics": {
    "retention": 0.92,
    "activity": 0.78,
    "volumeIn": 1500.0,
    "volumeOut": 120.0
  }
}
```

**Tier thresholds**

| Tier | Name | Score |
|---|---|---|
| 0 | Bronce | < 50 |
| 1 | Plata | ≥ 50 |
| 2 | Oro | ≥ 150 |
| 3 | Diamante | ≥ 500 |
| 4 | Platino | ≥ 1 000 |

**Error responses**

| Status | Body | Reason |
|---|---|---|
| 400 | `{ "error": "Wallet requerida" }` | Missing `address` |
| 500 | `{ "error": "<message>" }` | Horizon or internal error |

---

## POST /api/get-available-credit

Reads the current NFT tier for a wallet from the `vinculo_sbt` contract and returns the corresponding credit limit.

**Request**

```json
{ "userAddress": "G..." }
```

**Response 200**

```json
{
  "success": true,
  "tier": 2,
  "tierName": "Oro",
  "availableCredit": 600,
  "currency": "XLM"
}
```

**Credit limits by tier**

| Tier | Name | Credit (XLM) |
|---|---|---|
| 0 | Bronce | 0 (locked) |
| 1 | Plata | 300 |
| 2 | Oro | 600 |
| 3 | Diamante | 1 500 |
| 4 | Platino | 5 000 |

On contract or RPC errors the endpoint returns tier 0 / 0 XLM rather than a 5xx, so the UI degrades gracefully.

**Error responses**

| Status | Body | Reason |
|---|---|---|
| 400 | `{ "error": "Falta wallet" }` | Missing `userAddress` |
| 405 | `{ "error": "Method not allowed" }` | Non-POST request |

---

## POST /api/evaluate-and-mint

Validates eligibility, computes the tier via `/api/calculate-score`, and mints an SBT NFT on the `vinculo_sbt` contract using the admin keypair. Requires a valid nonce from `/api/nonce`.

**Request**

```json
{
  "userAddress": "G...",
  "nonce": "a3f8c2...",
  "totalVolume": 1500.0,
  "deposits": [
    { "amount": 500.0 },
    { "amount": 1000.0 }
  ]
}
```

- `nonce` — required. Must match the value returned by `/api/nonce` for this address and must not be expired.
- `totalVolume` — optional. Falls back to the sum of `deposits[].amount`, then to the live Horizon balance.
- `deposits` — optional array used only as a fallback for `totalVolume`.

**Response 200 — minted**

```json
{
  "status": "minted",
  "txHash": "abc123...",
  "tier": 2,
  "tierName": "Oro"
}
```

**Response 200 — pending (tier 0)**

```json
{
  "status": "pending",
  "message": "Nivel insuficiente",
  "tier": 0,
  "tierName": "Bronce"
}
```

**Error responses**

| Status | Body | Reason |
|---|---|---|
| 400 | `{ "success": false, "error": "address required" }` | Missing `userAddress` |
| 400 | `{ "success": false, "error": "Invalid or expired nonce" }` | Bad or expired nonce |
| 400 | `{ "success": false, "error": "Not eligible by history", "eligibility": {...} }` | Fewer than 3 on-chain interactions |
| 400 | `{ "success": false, "message": "Usuario ya posee este nivel exacto", ... }` | On-chain tier already matches computed tier |
| 500 | `{ "success": false, "error": "<message>" }` | Mint or RPC failure |

---

## GET /api/get-user-data

Reads the staking balance from the `staking_pool` contract for a given address and derives a legacy tier value. Used by the `Perfil` page.

**Query parameters**

| Param | Required | Description |
|---|---|---|
| `address` | yes | Stellar wallet address (`G...`) |

**Example**

```
GET /api/get-user-data?address=G...
```

**Response 200**

```json
{
  "totalXlmDeposited": 1500.0,
  "depositCount": 3,
  "nftLevel": 2
}
```

If the account does not exist on-chain (unfunded wallet), returns `{ totalXlmDeposited: 0, depositCount: 0, nftLevel: 0 }`.

**Error responses**

| Status | Body | Reason |
|---|---|---|
| 400 | `{ "error": "Falta la dirección de la wallet" }` | Missing `address` |
| 405 | `{ "error": "Método no permitido" }` | Non-GET request |
| 500 | `{ "error": "Error al comunicarse con Soroban" }` | RPC failure |
