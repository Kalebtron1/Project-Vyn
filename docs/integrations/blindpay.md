---
tags: [integration, blindpay, spei, onramp, offramp]
updated: 2026-10-22
issues: [91, 92]
files:
  - api/_blindpay-core.mjs
  - api/_blindpay-onramp.mjs
  - api/blindpay.js
  - api/onramp.js
  - api/_usdc.mjs
  - api/_supabase.mjs
  - api/validation.mjs
  - src/pages/Depositar.tsx
  - src/pages/Retiros.tsx
  - src/pages/Login.tsx
  - src/stellar/deposit.ts
  - backend/server.js
---

# BlindPay (SPEI on-ramp and off-ramp)

[BlindPay](https://blindpay.com/docs) converts fiat bank transfers to stablecoins and back.
Vyn uses it for Mexico's **SPEI**:

- **On-ramp (Depositar):** the user pays MXN by SPEI to a CLABE and ends up with USDC in
  the savings vault.
- **Off-ramp (Retiros → SPEI):** the user withdraws USDC from the vault and receives MXN in
  a bank account.

Everything runs against a BlindPay **development instance** on `stellar_testnet`. Development
instances only use **USDB**, BlindPay's test stablecoin; production instances only use USDC
or USDT on mainnet ([supported chains](https://blindpay.com/docs/kb/supported-chains)). The
UI always talks about USDC: USDB is an invisible test artifact.

## Environment variables (server only, never `VITE_`)

| Variable | Required | Used for |
|---|---|---|
| `BLINDPAY_API_KEY` | yes | `Authorization: Bearer` on every call. |
| `BLINDPAY_INSTANCE_ID` | yes | `/instances/{id}/…` paths. |
| `BLINDPAY_BASE_URL` | no | Default `https://api.blindpay.com/v1`. |
| `BLINDPAY_DEMO_RECEIVER_ID` | on-ramp | The **shared receiver** (customer) that owns every user's blockchain wallet. Must already have TOS and KYC approved. |
| `BLINDPAY_DEMO_BANK_ACCOUNT_ID` | off-ramp | The **single bank account** (SPEI CLABE) that receives every payout. |
| `BLINDPAY_PAYOUT_SECRET` | off-ramp | Secret of the backend payout wallet that holds USDB and signs the payout. |
| `OFFRAMP_FUNDING_ADDRESS` | off-ramp | Public key that receives the user's USDC before a payout. It needs a trustline to the project's USDC. Without it, `quote` and `payout` answer `503`. |
| `BLINDPAY_PARTNER_FEE_ID` | no | Adds a platform fee to quotes. Not in `.env.example`. |
| `BLINDPAY_NETWORK` / `BLINDPAY_ONRAMP_NETWORK` | no | Default `stellar_testnet` (mainnet: `stellar`). Not in `.env.example`. |
| `BLINDPAY_TOKEN` | no | Default `USDB` (mainnet: `USDC`). Not in `.env.example`. |
| `BLINDPAY_PAYOUT_PUBLIC` | — | In `.env.example` but never read: the public key is derived from the secret. |
| `BLINDPAY_WEBHOOK_SECRET` | — | In `.env.example` but never read: there is no webhook endpoint. |
| `SECRET_KEY_ADMIN` | on-ramp | Admin account that sends the USDC at settlement ([USDC faucet](usdc-faucet.md) uses it too). |
| `SUPABASE_*` | both | Wallet mapping, payins, settlement reservations and payouts ([Supabase](supabase.md)). |
| `ONRAMP_MAX_PAYIN_USD_CENTS` | no | Maximum per payin. Default `10000` (100 USD). |
| `ONRAMP_WALLET_DAILY_USD_CENTS` | no | Maximum settled per wallet per UTC day. Default `20000` (200 USD). |
| `ONRAMP_GLOBAL_DAILY_USD_CENTS` | no | Maximum settled overall per UTC day. Default `100000` (1,000 USD). |

## API endpoints (Vercel)

Both are single functions with an `action` query parameter, consolidated to stay under the
Hobby function limit ([Vercel](vercel.md)).

| Endpoint | Body / query | Does |
|---|---|---|
| `POST /api/onramp?action=init` | `{ walletAddress, email? }` | Registers the user's Stellar address as a blockchain wallet of the shared receiver (idempotent through Supabase). Called by `Login` after a Privy sign-in. |
| `POST /api/onramp?action=quote` | `{ walletAddress, amountMxn, email? }` | Payin quote, no CLABE. |
| `POST /api/onramp?action=payin` | same | Fresh quote + payin; returns the `clabe`. |
| `GET /api/onramp?action=status&id=pi_…` | | Payin status. |
| `POST /api/onramp?action=settle` | `{ payinId, walletAddress }` | Reserves, then sends USDC from the admin account to the wallet the payin was created for. |
| `POST /api/blindpay?action=quote` | `{ amount }` (USD) | Payout quote to the demo bank account, plus the `fundingAddress` the user pays. |
| `POST /api/blindpay?action=payout` | `{ amount, walletAddress, fundingTxHash }` | Verifies the user's USDC payment on Horizon, then fresh quote + authorize + sign + payout. |
| `GET /api/blindpay?action=status&id=…` | | Payout status. Records a final status in `ramp_payouts`. Retiros polls it after a payout. |

Amounts sent to BlindPay are **cents** (`Math.round(amount * 100)`). Quotes return cents and
exchange rates multiplied by 100; `summarizeQuote`, `summarizePayinQuote` and
`summarizePayin` convert them for the UI.

Validation (`api/validation.mjs`): payouts need at least 10 USD; payins at least 175 MXN as a
sanity floor (the frontend also requires ≥ 10 USD at the live rate). The local Express server
still has old on-ramp routes with older checks (≥ 5); `/api/onramp` and `/api/blindpay` there
use the real handlers.

## On-ramp flow

```
Login (Privy) ─▶ onramp init ─▶ BlindPay: POST /customers/{shared}/blockchain-wallets
                                 Supabase: ramp_customers (wallet → bw_…)
Depositar: amount MXN ─(debounced 500 ms)─▶ onramp quote ─▶ POST /payin-quotes (spei, USDB, sender amount)
"Generar CLABE" ─▶ onramp payin ─▶ POST /payin-quotes + POST /payins/evm ─▶ Supabase ramp_payins ─▶ { payinId, clabe }
UI polls onramp status every 4 s until status "completed"  
settling (in the browser):
  1. USDC trustline if missing (user signs, Horizon)
  2. onramp settle ─▶ settlePayin: ramp_payins row for that wallet ─▶ GET /payins/{id}: paid?
        ─▶ reserve_settlement (limits, one per payin) ─▶ admin pays USDC to the bound wallet (Horizon)
        ─▶ finish_settlement
  3. depositToVault(usd) ─▶ staking_pool.deposit (user signs). Best effort: if it fails the USDC stays in the wallet.
  4. refresh chain data, success screen
```

What BlindPay itself delivers is USDB to the user's address, which the user's wallet does
not trust. The app ignores that leg and pays the equivalent **USDC from the admin account**
instead, so on testnet the admin account funds every deposit.

**Testing.** Development instances complete every payin about 30 seconds after creation, so
the app only settles what BlindPay reports as paid. `settle` no longer accepts `simulate`. See
[payins docs](https://blindpay.com/docs/payins).

### Settlement rules

- A payin is only settled if `ramp_payins` has it, for the wallet that asks, and BlindPay
  reports it as paid to that same address. Payins created before this table existed are
  refused (`404`).
- USDC always goes to the wallet saved with the payin. The amount is the lower of the quoted
  amount and what BlindPay confirms.
- Until sessions exist, `walletAddress` in the body is only a claim: someone who knows both
  the payin ID and its wallet can trigger the settlement, but the USDC still goes to that
  wallet.
- `finish_settlement` releases a reservation only when the send declared that nothing went
  out (`notSent` in `sendUsdcFromAdmin`: Horizon result codes or a failure before submitting).
  After a timeout the transaction may have landed, so the reservation stays closed and `settle`
  answers `in_review` until someone reviews it. See
  [ADR-007](../decisions/ADR-007-supabase-fail-closed.md).

### Limits

Development instances complete any payin without a real SPEI, so these limits cap what can
leave the admin account: per payin (checked at `quote`, `payin` and `settle`), per wallet per
UTC day and overall per UTC day (checked atomically by `reserve_settlement`). The variables are
listed above.

**Attribution model.** One shared receiver with one blockchain wallet per user avoids a
human TOS acceptance per user in sandbox. Production needs a KYC'd receiver per user.

## Off-ramp flow

```
Retiros → SPEI: "Simular KYC" (UI animation only, 3.5 s) ─▶ amount ≥ 10 USDC
  quote (debounced 500 ms) ─▶ blindpay quote ─▶ POST /quotes (bank_account = demo, sender amount, USDB)
                                               + fundingAddress
"Confirmar" ─▶ 1. staking_pool.withdraw(user, amount) signed by the user → USDC lands in the user's wallet
               2. USDC payment user → fundingAddress, signed by the user and sent to Horizon
               3. blindpay payout { amount, walletAddress, fundingTxHash } ─▶ payoutWithFunding:
                    Horizon: the transaction succeeded, is under 15 min old, and is one USDC
                    payment from walletAddress to fundingAddress for at least amount
                    ─▶ ramp_payouts row (funding_tx_hash is unique) ─▶ quoteAndPayout:
                    POST /quotes ─▶ POST /payouts/stellar/authorize { quote_id, sender_wallet_address }
                    ─▶ sign the returned XDR (field `transaction_hash`) with BLINDPAY_PAYOUT_SECRET
                    ─▶ POST /payouts/stellar { quote_id, sender_wallet_address, signed_transaction }
                    ─▶ row `submitted` with the payout ID
               4. success screen; polls `status` every 5 s (up to 2 min) until a final status
```

- The destination CLABE shown in the UI is a fixed demo constant and every payout goes to
  `BLINDPAY_DEMO_BANK_ACCOUNT_ID`. The user's own bank account is never asked for.
- The USDB comes from the backend payout wallet. The user pays the same amount in USDC first,
  so the payout wallet only spends what users have paid.
- If a step fails, "Reintentar" skips the steps the user already signed, so it never
  withdraws or pays twice.
- Authorize → sign → submit runs in one request because the XDR's time bounds follow the
  quote's expiry. `TransactionBuilder.fromXDR(…, Networks.TESTNET)` is hard-coded in
  `executeStellarPayout`.

### Payout states (`ramp_payouts`)

| Status | Meaning |
|---|---|
| `verified` | Funding verified and recorded. BlindPay not called yet, or the payout ID could not be saved. |
| `submitted` | BlindPay accepted the payout. |
| `completed` | BlindPay paid the SPEI. |
| `failed` | BlindPay refused it or did not answer, or the payout failed later. |
| `refunded` | BlindPay refunded the payout. |

`failed` and `refunded` mean Vyn holds the user's USDC without paying the SPEI. For now the
USDC is returned by hand from the funding account. A hash is never retried automatically:
calling `payout` again with it answers `409`.

### Comparison with BlindPay's Stellar guide

The [payout with Stellar](https://blindpay.com/docs/payout-stellar) guide (read on
2026-11-03) authorizes, signs, **submits the transaction to Horizon itself**, and then calls
`POST /payouts/stellar`. Its comment says to keep `result.hash` to create the payout, but the
body field is `signed_transaction` and the guide never shows how it is serialized. Vyn sends
the signed XDR without submitting it. The code comment says this was verified in sandbox. Nobody
has re-tested it against the current guide, because a test spends USDB from the payout wallet.
Repeat it before mainnet.

## Data

- To BlindPay: the user's Stellar address, the email from Privy (as the wallet's display
  name `Vyn · email`), amounts.
- From BlindPay: quote and payin/payout IDs, amounts, rates, fees, `clabe`, status and the
  `tracking_*` objects. Statuses: `processing`, `on_hold`, `completed`, `failed`, `refunded`.
- Quotes expire after 5 minutes, which is why `payin` and `payout` always re-quote right
  before acting.

## Failure modes

| Failure | Behavior |
|---|---|
| Missing API key / instance / receiver | `502` with "BlindPay no configurado…"; Depositar shows the message under the quote. Missing demo bank account: `500`. |
| BlindPay error | `bpFetch` throws with BlindPay's `message`/`errors`; endpoints return `502` with it. |
| Payin `failed` or `refunded` | The UI stops waiting and shows an error; `settle` does not pay it. |
| Withdrawal succeeds, user does not pay | The USDC stays in the user's wallet. "Reintentar" asks only for the payment. |
| Funding paid, payout call does not arrive | "Reintentar" sends the same hash again. If no row exists yet, the payout runs. |
| Funding paid, payout fails | `502` and the row stays `failed`. The USDC is returned by hand. |
| Payout ends `failed` or `refunded` | Retiros shows it, and `status` records it in `ramp_payouts` for a manual refund. |
| Supabase down or `OFFRAMP_FUNDING_ADDRESS` missing | `503`, no payout. |
| Supabase down before sending | `503`, no USDC moves. |
| Settlement sent, `finish_settlement` fails | `200` with the hash, logged. The reservation stays closed, so a retry does not pay again. |
| Send times out | `409 in_review`. The reservation stays closed until a manual review. |
| Auto-deposit to the vault fails | USDC stays in the wallet; success screen says so. |

## Security issues (open)

- `payin`, `settle` and `payout` require the wallet session
  ([ADR-008](../decisions/ADR-008-wallet-session.md)). `init`, `quote` and `status` don't.
- Refunds for failed payouts are manual.
- No webhooks: status is polled every 4 s and `BLINDPAY_WEBHOOK_SECRET` is unused.

Community PRs #123 and #124 tried to fix #92 and #91 and were closed without merging.

## Testing

Step-by-step instructions, sentinel amounts and curl examples are in
[SPEI testing](../spei-testing.md).

## Related

- [Supabase](supabase.md) · [USDC faucet](usdc-faucet.md) · [Horizon](horizon.md) ·
  [Vercel](vercel.md)
