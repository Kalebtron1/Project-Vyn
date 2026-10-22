---
tags: [integration, pending, tech-debt]
updated: 2026-10-22
issues: [89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 104]
prs: [128, 129]
---

# Pending and half-finished integrations

What exists in `main` but is not connected, not used, mocked, or only partly done. Checked
against the code on 2026-10-22. Open issue numbers are given where one exists; "PR #128" and
"PR #129" are open community PRs that are not merged yet.

## Code that exists but nothing calls

| Item | Where | Notes |
|---|---|---|
| WebSocket replay hub | `src/ws/hub.ts`, `src/db/repositories/contractEventRepository.ts` | No server, table, producer or client. See [WebSocket](websocket.md). |
| `POST /api/nonce` | `api/nonce.js`, `backend/server.js` | No frontend caller. `consumeNonce` is exported but `evaluate-and-mint` never checks a nonce, and the store is in memory, which doesn't survive between serverless invocations (issues #89, #90). Uses one of the 12 Vercel functions. |
| `GET /api/get-user-data` | `api/get-user-data.js` | No caller. Approximates a tier from the position, which disagrees with the real score. Uses a Vercel function. |
| `GET /api/blindpay?action=status` | `api/blindpay.js` | The off-ramp UI never checks the payout status after the success screen. |
| `fetchTotalDeposited`, `fetchTotalWithdrawn` | `src/stellar/queries.ts` | Replaced by `readSavingsSnapshot`. |
| `VAULT_ID` | `src/stellar/contracts.ts` | Reference constant; the real vault is read on-chain. |
| `src/stellar/nft-metadata.json` | | Not imported; describes an older mint interface. |
| `acceslyBridge.ts`, `AcceslySignerBridge.tsx` | `src/lib/`, `src/components/` | Empty files kept "for old imports"; nothing imports them. |
| `@albedo-link/intent` | `package.json` | Not imported; the wallet kit has its own Albedo module. |
| `vinculo_lending.get_loan` | contract | The app never reads the active loan; see "In-memory state" below. |
| `vinculo_sbt.revoke`, `name`, `symbol`, `token_uri` | contract | Not used by the app. `token_uri` points to a third-party repo and tier 0 returns a 404 URL ([other services](other-services.md)); PR #129 moves the metadata into this repo. |

## Environment variables out of sync with `.env.example`

Declared but never read:

- `PUBLIC_KEY_ADMIN` (the public key is derived from `SECRET_KEY_ADMIN`),
- `BLINDPAY_PAYOUT_PUBLIC` (derived from `BLINDPAY_PAYOUT_SECRET`),
- `BLINDPAY_WEBHOOK_SECRET` (there is no webhook endpoint).

Read by the code but missing from `.env.example`:

- `VITE_PRIVY_APP_ID` (required for email login),
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_KEY`,
- `FAUCET_USDC_AMOUNT`, `BLINDPAY_PARTNER_FEE_ID`, `BLINDPAY_NETWORK`,
  `BLINDPAY_ONRAMP_NETWORK`, `BLINDPAY_TOKEN`, `MAX_REPLAY_EVENTS`.

[Deployment](../deployment.md#environment-variables) has the complete table.

## Mocks and demo shortcuts in the product

| Shortcut | Where | Real behavior missing |
|---|---|---|
| "Simular envío SPEI" | `Depositar.tsx`, `settle` with `simulate` | Accepted from any client on testnet (issue #92). |
| "Simular KYC" | `Retiros.tsx` | A 3.5 s animation; no KYC call. |
| Fixed destination CLABE and bank account | `Retiros.tsx` (`DEMO_CLABE`), `BLINDPAY_DEMO_BANK_ACCOUNT_ID` | The user's own account is never collected. |
| Shared BlindPay receiver | `BLINDPAY_DEMO_RECEIVER_ID` | One KYC for every user. |
| Settlement paid by the admin in USDC | `settlePayin` | BlindPay's own USDB delivery is ignored. |
| Loan countdown "1 month = 60 s" and default | `CreditSection.tsx`, `vinculo_lending` | UI-only timer; the contract stores a due date but nothing enforces it. Term-based interest and the due-date UI are in PR #128. |
| Daily withdrawal limit "0 / 5,000" | `Retiros.tsx` | Decorative. |
| MoneyGram withdrawal | `Retiros.tsx` | "Coming soon" card. |
| Testnet funding with Friendbot | `trustline.ts`, `PrivyBridge.tsx` | No mainnet equivalent (sponsored accounts). |
| Privy, Freighter and on-chain calls in E2E | `e2e/mocks/`, stubbed `/api` routes | E2E never signs or hits the network. |

## In-memory state that should come from the chain

- **Active loan:** `creditWithdrawn` lives in `AppContext`. Reloading the page forgets an
  open loan: the screen offers a new loan (which the contract rejects with "active loan
  exists") instead of the repayment, although `get_loan` would return it.
- **Deposit counter and unlock celebration** (`AppContext.addDeposit`) count only this
  session's deposits.
- **Mint history** is in `localStorage` per device (`vinculo_activity_mints`).

## Partly migrated to the data-cache rules (ADR-003)

- `Perfil.tsx` still reads balance, credit and score with its own `useEffect` + `fetch`
  calls instead of `useSavings` / `useCredit` / `useScore`, and still sends `depositCount`
  and `deposits` fields that no longer change the result (the score comes from the contract).
- `Depositar.tsx` polls the payin status with `setInterval` every 4 s (BlindPay status, not
  chain data, but it never stops on `failed`).
- `Retiros.tsx` and `Tesoreria.tsx` poll `getTransaction` without a deadline.
- ADR-003 says `readSavingsSnapshot` throws on network errors; it only does when a
  simulation fails. If `getAccount` fails it returns zeros, like an unfunded account.

## Inconsistent units and labels

- Savings are in **USDC**; loans and the treasury are in **XLM** (`vinculo_lending` is
  initialized with the native XLM token). `/api/get-available-credit` answers
  `currency: "XLM"` and the SBT metadata lists credit in XLM (issue #96).
- `/api/get-available-credit` returns tier 0 with `200` on any error, so an outage looks like
  "no credit" (issue #96).
- Score curve: `score = retention × log10(txCount + 1) × 100`. With full retention, Plata
  needs 3 transactions and Oro 31, but Diamante needs about 100,000 and Platino about
  10 billion, so tiers 3–4 are unreachable (issue #95).
- `scripts/stress-test.js` still uses the old Horizon-based formula.
- UI copy and comments still say "Accesly" (the email login before Privy), and some
  metadata says "Vínculo".

## Infrastructure gaps

| Gap | Issue / PR |
|---|---|
| Network (testnet RPC, Horizon, Friendbot, passphrase) hard-coded in 19 source files | #97 |
| Persistent contract storage never extends its TTL | #100 |
| Contracts emit no events | #101 (in PR #128) |
| `vinculo_sbt` has no tests (stale snapshots only); `vinculo_lending` has none | #99 (in PR #128), #98 |
| No slippage protection on vault withdrawals (`min_amounts_out = 0`) | #104 is closed, but the fix is in PR #128, not in `main` |
| CORS `*` on every API function | #94 |
| Faucet has no rate limit and fails open | #93 |
| No caller authentication on the API (mint, payout, settle) | #89, #91, #92 |
| `scripts/upgrade_contract.sh` and parts of the [migration guide](../contracts/migration.md) call an `upgrade` function that no contract has | — |
| CI runs only the contracts; frontend lint, tests and build are not checked on PRs (PR #128 adds a job) | — |
| The local Express server lacks `/api/blindpay?action=…`, so the off-ramp can't run with `node backend/server.js` | — |
| Runtime logs last 1 hour on Vercel Hobby; no log drain or error tracking | — |
| DeFindex yield needs `scripts/harvest_keeper.sh` running on someone's machine | — |

## Related

- [Integrations overview](overview.md) · [SPEI testing](../spei-testing.md) ·
  [Vercel](vercel.md)
