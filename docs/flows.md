---
tags: [flows]
updated: 2026-10-22
files:
  - src/pages/Login.tsx
  - src/components/DepositModal.tsx
  - src/pages/Depositar.tsx
  - src/pages/Perfil.tsx
  - src/components/CreditSection.tsx
  - src/pages/Retiros.tsx
  - src/pages/Tesoreria.tsx
  - api/_scoring-core.mjs
  - api/evaluate-and-mint.js
---

# Core flows

Step by step, as the code does it today. Every write waits for confirmation and then calls
`useRefreshChainData()(address)` unless noted ([ADR-003](decisions/ADR-003-no-polling-cache.md)).

## 1. Sign in

```
Any protected route without a session ─▶ /login
  A) "Conectar wallet": connectWallet() ─▶ Stellar Wallets Kit modal ─▶ { address, walletId }
  B) "Entrar con correo": privyLogin() ─▶ Privy modal (email, Google or passkey)
        PrivyBridge: oldest Stellar wallet or createWallet ─▶ Friendbot if new
        ─▶ connected event ─▶ POST /api/onramp?action=init (BlindPay mapping, fire and forget)
  both: setSession(address, provider) ─▶ vinculo_wallet, vinculo_wallet_provider,
        vinculo_onboarded = "1" (localStorage + cookie) ─▶ navigate("/")
```

`/bienvenida` (onboarding slides) only appears when there is an address but
`vinculo_onboarded` is not set; finishing it sends the user to `/login`.
Details: [Stellar Wallets Kit](integrations/stellar-wallets-kit.md), [Privy](integrations/privy.md).

## 2. Activate USDC (Perfil)

```
Perfil mounts ─▶ ensureTestnetAccount (Friendbot if needed) + hasUsdcTrustline
"Activar USDC" ─▶ changeTrust(USDC) signed by the user ─▶ Horizon
                ─▶ POST /api/faucet-usdc ─▶ admin sends 2 USDC (once per wallet)
```

See [USDC faucet](integrations/usdc-faucet.md).

## 3. Deposit from the wallet

```
Home ─▶ "Depositar" ─▶ DepositModal: choose "Wallet" (or "SPEI" ─▶ flow 4)
  amount (USDC) ─▶ check USDC balance on Horizon
  ─▶ staking_pool.deposit(address, amount × 10^7) ─▶ prepareTransaction ─▶ sign ─▶ send
  ─▶ success screen at once; refresh after waitForConfirmation
staking_pool ─▶ token.transfer(user → pool) ─▶ DeFindex vault.deposit(from = pool) ─▶ Shares(user) += minted
```

The modal refuses a different address than the session's. See [DeFindex](integrations/defindex.md).

## 4. Deposit by SPEI (on-ramp)

```
/depositar: amount in MXN ─▶ (500 ms) POST /api/onramp?action=quote ─▶ USDC to receive
"Generar CLABE" ─▶ POST /api/onramp?action=payin ─▶ CLABE
poll GET /api/onramp?action=status every 4 s until "completed" (sandbox: ~30 s)
   or "Simular envío SPEI"
settle: USDC trustline if missing (user signs)
        POST /api/onramp?action=settle ─▶ admin sends the USDC to the user
        depositToVault (user signs; best effort) ─▶ refresh ─▶ success
```

See [BlindPay](integrations/blindpay.md) and [SPEI testing](spei-testing.md).

## 5. Score and SBT mint

```
Perfil ─▶ fetchContractBalance + POST /api/get-available-credit (current tier)
       ─▶ POST /api/calculate-score { address }
            getOnChainAggregates: staking_pool.get_total_deposited / get_total_withdrawn /
            get_position / get_tx_count (simulations)
            computeFinancialReputation ─▶ { score, tier, eligibility, metrics }
"Reclamar NFT" (enabled when the score's tier is higher than the on-chain tier and the
balance is not 0)
  Freighter sessions: requestAccess() must return the same address
  ─▶ POST /api/evaluate-and-mint { userAddress, totalVolume }
       ─▶ POST /api/calculate-score (same deployment, over HTTP)
       ─▶ anomaly? 422  ·  tier 0? { status: "pending" }
       ─▶ vinculo_sbt.mint(admin, user, tier) signed by SECRET_KEY_ADMIN
       ─▶ poll getTransaction up to 45 s ─▶ { status: "minted", txHash, tier, tierName }
  ─▶ NFTModal, mint saved to local history, refresh
```

**Formula** (`api/_scoring-core.mjs`):

```
if txCount < 3: score = 0, tier 0 (not eligible)
retention = min(position / totalDeposited, 1)
activity  = log10(txCount + 1)
score     = retention × activity × 100        (× 0.2 if position < 10 % of totalDeposited)
score     = min(score, 1000)
tier      = ≥1000 Platino · ≥500 Diamante · ≥150 Oro · ≥50 Plata · else Bronce
```

The contract stores whatever tier is minted, including a lower one if the score dropped. It
only rejects minting the same tier twice.

## 6. Available credit

```
useCredit(address) (shared by CreditSection, ProgressRing, NftLevelCard, Historial)
  ─▶ POST /api/get-available-credit { userAddress }
       simulate vinculo_sbt.get_tier(user) with the admin account as source
       ─▶ { success, tier, tierName, availableCredit, currency: "XLM" }
tier ≥ 1 ─▶ show the limit and the withdraw button · tier 0 ─▶ locked
```

Read once and cached; refreshed after a mint, loan or repayment. Any error returns tier 0.

## 7. Loan and repayment

```
"Retirar a mi wallet" ─▶ vinculo_lending.request_loan(user, limit × 10^7, months = 1)
   contract: tier from vinculo_sbt (1–4), no active loan, amount ≤ tier limit,
             enough pool liquidity ─▶ XLM transfer to the user; Loan{ total_owed = 105 % }
   UI: creditWithdrawn = true (memory only), 60 s countdown, then "en mora" (UI only)
"Pagar" ─▶ vinculo_lending.repay(user, limit × 1.05 × 10^7)
   contract: takes min(amount, total_owed); when paid off, 5 % goes to AccruedInterest
```

Loans are in **XLM**, savings in USDC. The open loan is not read back from the chain, so a
reload forgets it ([pending](integrations/pending.md)).

## 8. Withdraw savings

```
/retiros ─▶ method "USDC": amount ≤ position
   ─▶ staking_pool.withdraw(user, amount) ─▶ vault.withdraw(shares) ─▶ USDC to the user
   ─▶ poll getTransaction every 2 s (no deadline) ─▶ refresh
method "SPEI": "Simular KYC" ─▶ amount ≥ 10 USDC ─▶ POST /api/blindpay?action=quote
   ─▶ withdraw as above ─▶ POST /api/blindpay?action=payout (payout wallet → demo CLABE)
```

## 9. Treasury (`/tesoreria`)

Visible only when the session address equals `VITE_TREASURY_ADDRESS` (the contract enforces
the real check). Reads `get_accrued_interest` and `get_pool_balance`; actions
`withdraw_interest(amount)`, `withdraw_pool(amount)` and `fund_pool(from, amount)`, all signed
by the treasury wallet.

## 10. Reading savings

```
useSavings(address) ─▶ readSavingsSnapshot: getAccount once, then in parallel
   get_position, get_total_deposited, get_total_withdrawn (simulations, ÷ 10^7)
useYield = position − (deposited − withdrawn)
```

Simulations are free (nothing is submitted). An address that doesn't exist on-chain reads as
all zeros.
