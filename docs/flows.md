# Core Flows

## 1. Authentication and wallet setup

```
User visits app
  └─ RequireWallet: no vinculo_wallet in localStorage?
       └─ Redirect to /login

/login
  └─ User connects wallet (Freighter on desktop, Albedo on mobile)
       └─ connect() returns the Stellar address
            └─ saved to localStorage: vinculo_wallet (+ vinculo_wallet_provider)
                 └─ onboarded? check localStorage.vinculo_onboarded
                      └─ no → redirect to /bienvenida (Onboarding)
                      └─ yes → redirect to /
```

---

## 2. Deposit

```
User taps "Depositar Ganancias" on Index
  └─ DepositModal opens
       └─ User enters XLM amount
            └─ requestAccess() → Freighter returns address
                 └─ Build TransactionBuilder with staking_pool.deposit(address, amount)
                      └─ server.prepareTransaction(tx)
                           └─ signTransaction(xdr) via Freighter
                                └─ server.sendTransaction(signedTx)
                                     └─ AppContext.addDeposit(amount)
                                          └─ ProgressRing and BalanceCard re-render
```

**Key files:** `src/components/DepositModal.tsx`, `src/stellar/contracts.ts`

---

## 3. Credit scoring and NFT minting

```
User opens /perfil and taps "Reclamar NFT"
  └─ POST /api/evaluate-and-mint
       { userAddress, totalVolume }
         └─ internally: POST /api/calculate-score
              { address, totalDeposited }
                └─ fetch Horizon /accounts/{address}/effects (last 120)
                     └─ filter: account_credited (deposit) / account_debited (withdrawal)
                          └─ computeFinancialReputation(history, totalDeposited)
                               └─ weightedVolume × retentionRate × activityFactor / 60
                                    └─ map score → tier (0–4)
         └─ tier >= 1?
              └─ yes: admin keypair signs vinculo_sbt.mint(admin, userAddress, tier)
                        └─ returns { txHash, tier, tierName, status: "minted" }
              └─ no:  returns { status: "pending", tier: 0 }
```

**Score formula:**
```
score = (weightedVolume × retentionRate × log10(txCount + 1)) / 60

weightedVolume = Σ deposit.amount × (1 / (daysAgo + 1))
retentionRate  = currentBalance / totalDeposited
```

If `currentBalance < 10% of totalDeposited`, score is penalized by 80%.

**Key files:** `api/evaluate-and-mint.js`, `api/calculate-score.js`

---

## 4. Available credit display

```
CreditSection mounts (and every 8 seconds)
  └─ POST /api/get-available-credit { userAddress }
       └─ admin keypair simulates vinculo_sbt.get_tier(userAddress)
            └─ returns tier number (0–4)
                 └─ look up CREDIT_LIMITS[tier]
                      └─ return { tier, tierName, availableCredit, currency: "XLM" }
  └─ tier >= 1 → show credit limit and "Retirar" button
  └─ tier == 0 → show locked state
```

**Key files:** `api/get-available-credit.js`, `src/components/CreditSection.tsx`

---

## 5. Loan request and repayment

```
User taps "Retirar a mi Wallet" in CreditSection
  └─ requestAccess() → Freighter address
       └─ validate address === localStorage.vinculo_wallet
            └─ Build vinculo_lending.request_loan(address, amountInStroops, months=1)
                 └─ server.prepareTransaction → signTransaction → sendTransaction
                      └─ AppContext.withdrawCredit()
                           └─ 60-second repayment countdown starts

User taps "Pagar X XLM"
  └─ Build vinculo_lending.repay(address, principal × 1.05 in stroops)
       └─ server.prepareTransaction → signTransaction → sendTransaction
            └─ window.location.reload()
```

**Interest rate:** 5% flat, applied at repayment time in the UI.  
**Key files:** `src/components/CreditSection.tsx`

---

## 6. Staking balance read

```
BalanceCard / Perfil mount
  └─ fetchContractBalance(walletAddress)   [src/stellar/queries.ts]
       └─ simulate staking_pool.get_balance(address)
            └─ scValToNative(retval) / 10_000_000  → XLM balance

  └─ fetchStakeInfo(walletAddress)         [src/stellar/queries.ts]
       └─ simulate staking_pool.get_stake(address)
            └─ returns [amount, unlockTime, months, apy]
```

Both calls are read-only simulations (no transaction submitted, no fee charged).
