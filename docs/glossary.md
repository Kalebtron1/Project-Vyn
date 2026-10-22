---
tags: [glossary]
updated: 2026-10-22
---

# Glossary

| Term | Meaning in this project |
|---|---|
| **Vyn** | The product. Older code and contracts still use the name *vínculo* / `vinculo_*`. |
| **Staking pool** | `staking_pool` contract. Holds users' USDC deposits and invests them in a DeFindex vault. |
| **DeFindex** | Stellar yield protocol. The pool deposits into a DeFindex vault and earns its yield. |
| **Shares** | A user's units in the pool. Their value in USDC grows with the vault's yield. |
| **Score** | Reputation number computed by `api/_scoring-core.mjs` from Horizon history and the user's position. |
| **Tier** | Level 0–4 derived from the score: Bronce, Plata, Oro, Diamante, Platino. It sets the credit limit. |
| **SBT** | Soulbound token: the non-transferable NFT in `vinculo_sbt` that stores the user's tier on-chain. |
| **Mint / evaluate** | `api/evaluate-and-mint` computes the score and mints the SBT for that tier, signed with the admin key. |
| **Lending** | `vinculo_lending` contract. Lends USDC up to the tier's limit; `request_loan` and `repay`. |
| **Treasury** | Interest earned by the lending pool, managed from the Tesorería page. |
| **Horizon** | Stellar's REST API for accounts and transaction history. It indexes new transactions a few seconds after they are confirmed. |
| **Soroban RPC** | Endpoint used to simulate and send contract calls. |
| **Privy** | Email, Google and passkey login with an embedded Stellar wallet. See [ADR-001](decisions/ADR-001-lazy-privy.md). |
| **Stellar Wallets Kit** | Library that connects Freighter, xBull, Lobstr, Hana, Rabet, Albedo and WalletConnect. |
| **Passkey** | Fingerprint or face login stored on the device, linked to an email account from Perfil. |
| **SPEI** | Mexico's instant bank transfer system. Deposits and withdrawals in MXN go through BlindPay. |
| **BlindPay** | On/off-ramp provider that converts MXN (SPEI) to USDC and back. |
| **Faucet** | Testnet endpoint that sends test USDC to new users. |
| **Stellar Wave / Drips** | Program that pays contributors points for completed issues. Issues carry the `Stellar Wave` label and a `complexity:*` label. |
