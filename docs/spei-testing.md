---
tags: [testing, spei, blindpay]
updated: 2026-10-22
issues: [91, 92]
files:
  - src/pages/Depositar.tsx
  - src/pages/Retiros.tsx
  - api/onramp.js
  - api/blindpay.js
  - api/_blindpay-onramp.mjs
  - api/_blindpay-core.mjs
  - backend/server.js
---

# Testing SPEI (BlindPay sandbox)

How to exercise the SPEI deposit (on-ramp) and withdrawal (off-ramp) today. How the
integration works is in [BlindPay](integrations/blindpay.md). Everything here uses a
BlindPay **development instance**, Stellar testnet and test tokens: no real pesos move.

## What the sandbox does for you

From BlindPay's docs ([payins](https://blindpay.com/docs/essentials/payins),
[payouts](https://blindpay.com/docs/essentials/payouts)):

- Every payin on a development instance **completes automatically about 30 seconds** after
  it is created. Nobody needs to send a real SPEI.
- Payouts on a development instance also complete automatically.
- Quotes expire after 5 minutes.
- **Sentinel amounts** force other outcomes. They apply to `request_amount` in minor units,
  which in Vyn is the amount typed × 100:

| Typed amount | `request_amount` | Result |
|---|---|---|
| 666 (MXN on Depositar, USDC on Retiros) | `66600` | `failed` |
| 777 | `77700` | `refunded` |
| anything else | | `completed` |

## One-time setup

### 1. BlindPay

1. Create an account at app.blindpay.com and a **development** instance.
2. Create an API key → `BLINDPAY_API_KEY`; instance ID → `BLINDPAY_INSTANCE_ID`.
3. Create a receiver (customer) and get its TOS and KYC approved in the sandbox →
   `BLINDPAY_DEMO_RECEIVER_ID`. Every user's wallet is registered under this one receiver.
4. Add a SPEI bank account to that receiver → `BLINDPAY_DEMO_BANK_ACCOUNT_ID`. Every
   payout goes here.

### 2. Stellar testnet accounts

| Account | Needs | Variable |
|---|---|---|
| Funding account | XLM and a trustline to the project's USDC. It receives the user's USDC before each payout. The admin account works. | `OFFRAMP_FUNDING_ADDRESS` (public key only) |
| Payout wallet | XLM (Friendbot), a trustline to BlindPay's **USDB** on testnet, and a USDB balance. BlindPay suggests funding test wallets with a payin, which auto-completes. On 2026-05-15 BlindPay rotated the testnet USDB issuer ([changelog](https://blindpay.com/changelog)), so a trustline created before then points at the old asset. | `BLINDPAY_PAYOUT_SECRET` |
| Admin account | XLM, a trustline to the project's USDC (issuer starting with `GATALTGT`) and a USDC balance, topped up by hand. It pays every on-ramp settlement and the faucet. | `SECRET_KEY_ADMIN` |

### 3. Other variables

`STAKING_CONTRACT_ID`, `VITE_STAKING_CONTRACT_ID` and the rest from
[Deployment](deployment.md#environment-variables). Settlement needs Supabase (`SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY`) in every environment: without it, the wallet mapping and payins
stay in memory until the server restarts and `settle` answers `503`.

## Where to run it

| Option | On-ramp | Off-ramp | Notes |
|---|---|---|---|
| Production or a Vercel preview | ✅ | ✅ | Uses the variables set in Vercel. Easiest. |
| `vercel dev` locally | ✅ | ✅ | Runs `api/` like Vercel. Needs the Vercel CLI and a linked project. |
| `npm run dev` + `node backend/server.js` | ✅ | ✅ | The Express server forwards `/api/onramp`, `/api/blindpay` and `/api/faucet-usdc` to the real handlers. Vite runs on port 8080 and proxies `/api` to port 3000. |

## On-ramp (Depositar) step by step

1. Sign in. Email (Privy) is the intended path and registers the wallet with BlindPay at
   login; any kit wallet also works, because quoting registers it on demand.
2. Home → **Depositar** → SPEI (or open `/depositar`).
3. Type an amount in MXN worth at least 10 USD (about 175 MXN or more). The quote appears
   after half a second: rate, BlindPay fee and USDC to receive.
4. Tap **Generar CLABE**. A payin is created and the CLABE is shown. The page polls the
   status every 4 seconds.
5. Wait about 30 seconds for the sandbox to complete the payin. The app settles it after that.
6. Approve the signatures the wallet asks for:
   - the USDC trustline, the first time;
   - the deposit into the vault, after the admin sends the USDC.
7. The success screen says whether the USDC went into the vault or stayed in the wallet.

Check the result:

- Home balance and history (refreshed automatically after the deposit).
- The settlement transaction on StellarExpert (admin → user, USDC).
- A row in `ramp_settlements` with the payin ID and status `sent`.

### Failure cases worth trying

- **666 MXN** → the payin fails, and the page stops waiting and shows an error.
- **777 MXN** → the payin is refunded, with the same result.
- An amount worth more than 100 USD → the quote shows the limit and no CLABE is generated.
- Close the tab while "Liquidando…": the USDC may already be in the wallet without being
  deposited. Deposit it manually from Home.

## Off-ramp (Retiros → SPEI) step by step

1. Have USDC in the vault (deposit first).
2. **Retiros** → choose **SPEI** → **Retirar**.
3. Tap **Simular KYC**. It's a 3.5-second animation; nothing is sent to BlindPay.
4. Type at least 10 USDC (and no more than the balance). The MXN quote appears.
5. Tap **Confirmar** and sign twice: the vault withdrawal, then the USDC payment to the
   funding account (`OFFRAMP_FUNDING_ADDRESS`). The backend verifies that payment on Horizon
   and creates the payout from the payout wallet to the demo bank account.
6. The success screen shows the MXN amount and the payout status, which it refreshes every
   5 seconds until BlindPay closes it.

Check the result:

- The USDC payment on StellarExpert (user → funding account).
- A row in `ramp_payouts` with the funding hash and status `submitted`, then `completed`.

Failure cases: **666 USDC** → payout `failed`; **777** → `refunded`. The screen shows it and
the row ends in that state. The user's USDC is already in the funding account and is returned
by hand.

## curl reference

Replace `BASE` with the deployment URL and `G…` with a testnet address.

```bash
# On-ramp quote (registers the wallet if needed)
curl -s -X POST "$BASE/api/onramp?action=quote" -H 'Content-Type: application/json' \
  -d '{"walletAddress":"G...","amountMxn":500}'

# Create the payin (returns payinId and clabe)
curl -s -X POST "$BASE/api/onramp?action=payin" -H 'Content-Type: application/json' \
  -d '{"walletAddress":"G...","amountMxn":500}'

# Payin status
curl -s "$BASE/api/onramp?action=status&id=PAYIN_ID"

# Off-ramp quote (no funds move)
curl -s -X POST "$BASE/api/blindpay?action=quote" -H 'Content-Type: application/json' \
  -d '{"amount":25}'

# Payout status
curl -s "$BASE/api/blindpay?action=status&id=PAYOUT_ID"
```

Do **not** call `action=settle` or `action=payout` by hand against a shared
environment: both move funds (admin USDC, payout-wallet USDB), and neither has a session
check yet. `action=payout` only runs with a verified USDC payment that has not been used.

## Risks while testing

| Risk | Detail | Issue |
|---|---|---|
| Manual refunds | A failed or refunded payout leaves the user's USDC in the funding account until someone returns it. | — |
| No session on settle | `walletAddress` in the body is only a claim, although the USDC always goes to the payin's wallet and daily limits apply. | #89 |
| Shared admin key | The admin account also signs SBT mints and funds the faucet. | — |
| Shared receiver and bank account | All users share one KYC'd receiver and all payouts go to one CLABE. Fine for a demo, not for production. | — |
| No webhooks | Status is only known by polling; `BLINDPAY_WEBHOOK_SECRET` is unused. | — |

## Before mainnet

- Remove or server-gate "Simular KYC".
- Production instance: `BLINDPAY_NETWORK` / `BLINDPAY_ONRAMP_NETWORK = stellar`,
  `BLINDPAY_TOKEN = USDC`.
- Replace the hard-coded `Networks.TESTNET` in `executeStellarPayout` and re-check the
  payout sequence against BlindPay's Stellar tutorial.
- Per-user receivers with real KYC, the user's own bank account for payouts, and webhooks
  with signature verification.
- Decide where settlement USDC comes from (BlindPay delivering USDC to the user directly
  instead of the admin account paying).
