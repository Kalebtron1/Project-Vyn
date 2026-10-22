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
| `BLINDPAY_PARTNER_FEE_ID` | no | Adds a platform fee to quotes. Not in `.env.example`. |
| `BLINDPAY_NETWORK` / `BLINDPAY_ONRAMP_NETWORK` | no | Default `stellar_testnet` (mainnet: `stellar`). Not in `.env.example`. |
| `BLINDPAY_TOKEN` | no | Default `USDB` (mainnet: `USDC`). Not in `.env.example`. |
| `BLINDPAY_PAYOUT_PUBLIC` | — | In `.env.example` but never read: the public key is derived from the secret. |
| `BLINDPAY_WEBHOOK_SECRET` | — | In `.env.example` but never read: there is no webhook endpoint. |
| `SECRET_KEY_ADMIN` | on-ramp | Admin account that sends the USDC at settlement ([USDC faucet](usdc-faucet.md) uses it too). |
| `SUPABASE_*` | on-ramp | Wallet mapping and settlement idempotency ([Supabase](supabase.md)). |

## API endpoints (Vercel)

Both are single functions with an `action` query parameter, consolidated to stay under the
Hobby function limit ([Vercel](vercel.md)).

| Endpoint | Body / query | Does |
|---|---|---|
| `POST /api/onramp?action=init` | `{ walletAddress, email? }` | Registers the user's Stellar address as a blockchain wallet of the shared receiver (idempotent through Supabase). Called by `Login` after a Privy sign-in. |
| `POST /api/onramp?action=quote` | `{ walletAddress, amountMxn, email? }` | Payin quote, no CLABE. |
| `POST /api/onramp?action=payin` | same | Fresh quote + payin; returns the `clabe`. |
| `GET /api/onramp?action=status&id=pi_…` | | Payin status. |
| `POST /api/onramp?action=settle` | `{ payinId, simulate? }` | Sends USDC from the admin account to the payin's wallet. |
| `POST /api/blindpay?action=quote` | `{ amount }` (USD) | Payout quote to the demo bank account. |
| `POST /api/blindpay?action=payout` | `{ amount }` | Fresh quote + authorize + sign + payout. |
| `GET /api/blindpay?action=status&id=…` | | Payout status. The UI never calls it. |

Amounts sent to BlindPay are **cents** (`Math.round(amount * 100)`). Quotes return cents and
exchange rates multiplied by 100; `summarizeQuote`, `summarizePayinQuote` and
`summarizePayin` convert them for the UI.

Validation (`api/validation.mjs`): payouts need at least 10 USD; payins at least 175 MXN as a
sanity floor (the frontend also requires ≥ 10 USD at the live rate). The local Express server
uses older checks (≥ 5).

## On-ramp flow

```
Login (Privy) ─▶ onramp init ─▶ BlindPay: POST /receivers/{shared}/blockchain-wallets
                                 Supabase: onramp_users (wallet → bw_…)
Depositar: amount MXN ─(debounced 500 ms)─▶ onramp quote ─▶ POST /payin-quotes (spei, USDB, sender amount)
"Generar CLABE" ─▶ onramp payin ─▶ POST /payin-quotes + POST /payins/evm ─▶ { payinId, clabe }
UI polls onramp status every 4 s until status "completed"   (or the user taps "Simular envío SPEI")
settling (in the browser):
  1. USDC trustline if missing (user signs, Horizon)
  2. onramp settle ─▶ settlePayin: GET /payins/{id}; if paid (or simulate) and not yet settled
        ─▶ admin pays receiver_amount USDC to payin.address (Horizon) ─▶ Supabase onramp_settlements
  3. depositToVault(usd) ─▶ staking_pool.deposit (user signs). Best effort: if it fails the USDC stays in the wallet.
  4. refresh chain data, success screen
```

What BlindPay itself delivers is USDB to the user's address, which the user's wallet does
not trust. The app ignores that leg and pays the equivalent **USDC from the admin account**
instead, so on testnet the admin account funds every deposit.

**Simulate.** BlindPay offers no endpoint to force a payin as paid, so `settle` accepts
`simulate: true` and settles an unpaid payin when the token is `USDB` or the network name
contains `testnet`. The "Simular envío SPEI" button is always visible on the CLABE screen.
In development BlindPay auto-completes payins about 30 seconds after creation anyway
([payins docs](https://blindpay.com/docs/essentials/payins)).

**Attribution model.** One shared receiver with one blockchain wallet per user avoids a
human TOS acceptance per user in sandbox. Production needs a KYC'd receiver per user.

## Off-ramp flow

```
Retiros → SPEI: "Simular KYC" (UI animation only, 3.5 s) ─▶ amount ≥ 10 USDC
  quote (debounced 500 ms) ─▶ blindpay quote ─▶ POST /quotes (bank_account = demo, sender amount, USDB)
"Confirmar" ─▶ 1. staking_pool.withdraw(user, amount) signed by the user → USDC lands in the user's wallet
               2. blindpay payout ─▶ quoteAndPayout:
                    POST /quotes ─▶ POST /payouts/stellar/authorize { quote_id, sender_wallet_address }
                    ─▶ sign the returned XDR (field `transaction_hash`) with BLINDPAY_PAYOUT_SECRET
                    ─▶ POST /payouts/stellar { quote_id, sender_wallet_address, signed_transaction }
               3. success screen with the MXN amount (no status polling)
```

- The destination CLABE shown in the UI is a fixed demo constant and every payout goes to
  `BLINDPAY_DEMO_BANK_ACCOUNT_ID`. The user's own bank account is never asked for.
- The USDB comes from the backend payout wallet, not from the user. The user's USDC stays in
  their wallet after step 1.
- Authorize → sign → submit runs in one request because the XDR's time bounds follow the
  quote's expiry. BlindPay's current Stellar tutorial also submits the signed transaction to
  Horizon before creating the payout ([payout with Stellar](https://blindpay.com/docs/payout-stellar));
  Vyn only sends the signed XDR to BlindPay, which the code comment says was verified in
  sandbox. Re-check this before mainnet.
- `TransactionBuilder.fromXDR(…, Networks.TESTNET)` is hard-coded in `executeStellarPayout`.

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
| Payin `failed` or `refunded` | The UI only checks for `completed`, so it keeps polling forever. "Simular envío SPEI" would still settle it. |
| Withdrawal succeeds, payout fails | The user's USDC is already out of the vault (in their wallet); the UI shows an error. Nothing is rolled back. |
| Settlement sent, Supabase write fails | `502` although USDC was sent; a retry pays again. |
| Auto-deposit to the vault fails | USDC stays in the wallet; success screen says so. |

## Security issues (open)

- **#91** `action=payout` only validates `amount`. Anyone can call it and spend the payout
  wallet's USDB without having withdrawn anything.
- **#92** `settle` checks then writes, so parallel calls can both pay; and `simulate` comes
  from the request body, so on testnet anyone can create a payin of any size and have the
  admin account pay it in USDC.
- No endpoint checks who is calling: there is no session or signature on the backend.
- No webhooks: status is polled every 4 s and `BLINDPAY_WEBHOOK_SECRET` is unused.

Community PRs #123 and #124 tried to fix #92 and #91 and were closed without merging.

## Testing

Step-by-step instructions, sentinel amounts and curl examples are in
[SPEI testing](../spei-testing.md).

## Related

- [Supabase](supabase.md) · [USDC faucet](usdc-faucet.md) · [Horizon](horizon.md) ·
  [Vercel](vercel.md)
