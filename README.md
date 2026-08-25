# Project Vyn

Project Vyn is a Vite + React application backed by Stellar/Soroban contract calls. Authentication is wallet-based (Freighter, Albedo, xBull, Lobstr, Hana, Rabet, or Privy) — there is no separate auth backend.

## Getting Started

1. Copy `.env.example` to `.env.local`.
2. Fill in the variables described below.
3. Install dependencies with `npm install`.
4. Start the app with `npm run dev`.

## Run Locally From Scratch

Use this flow if you are a new contributor and want to reproduce the app on your machine:

1. Clone the repository.
2. Copy `.env.example` to `.env.local`.
3. Fill in the environment variables with your own values or with the team-provided testnet values.
4. Run `npm install` in the repo root.
5. Start the frontend with `npm run dev`.
6. If you need to verify backend behavior locally, run `node backend/server.js` from the `backend/` folder in a separate terminal.
7. Run `npm run check:health` to verify `/api/health` and `/api/readiness` return the expected service signals.

### What you need to replicate

- A Stellar wallet to log in. Supported wallets include **Freighter** (desktop browser extension), **Albedo** (mobile/web), **xBull**, **Lobstr**, **Hana**, **Rabet**, and **Privy** (email/Google/Apple login). See [Wallet providers & fallback routing](docs/wallets.md) for the full compatibility matrix.
- A Stellar testnet admin account for `SECRET_KEY_ADMIN` and `PUBLIC_KEY_ADMIN`.
- The deployed Soroban contract IDs for `NFT_CONTRACT_ID`, `VITE_LENDING_CONTRACT_ID`, and the staking_pool (`VITE_STAKING_CONTRACT_ID` / `STAKING_CONTRACT_ID`).

If you do not have those values yet, you can still read the code and work on UI or docs changes, but wallet, scoring, and minting flows will not work end to end.

## Environment Variables

The project uses the following variables:

- `PUBLIC_KEY_ADMIN`
- `SECRET_KEY_ADMIN`
- `NFT_CONTRACT_ID`
- `VITE_LENDING_CONTRACT_ID`
- `VITE_STAKING_CONTRACT_ID` — staking_pool (DeFindex-backed) contract ID, read by the frontend (`src/stellar/contracts.ts`).
- `STAKING_CONTRACT_ID` — same staking_pool contract ID, read by the serverless API functions (`api/get-user-data.js`, `api/evaluate-and-mint.js`). These two must hold the **same** contract ID; there is no hardcoded fallback, so the API returns a clear error if it is missing.
- `VITE_TREASURY_ADDRESS` — treasury wallet (`G…` address). The only wallet that can see and operate the treasury panel (loan-interest profit). UI gating is cosmetic; the real authorization is enforced on-chain by `vinculo_lending.withdraw_interest`.
- `PORT`

`VERCEL_OIDC_TOKEN` is created by Vercel for deployment workflows and is not required for normal local development.

## How To Get Each Value

### Stellar admin keys

1. Create or reuse a dedicated Stellar testnet account for backend operations.
2. Copy the account secret into `SECRET_KEY_ADMIN`.
3. Derive the matching public key from that account and place it in `PUBLIC_KEY_ADMIN`.
4. Keep the secret out of version control. Use `.env.local` only.

### Contract IDs

1. Deploy the NFT contract to Soroban testnet.
2. Copy the contract ID from the deployment output into `NFT_CONTRACT_ID`.
3. Deploy the lending contract to Soroban testnet.
4. Copy that contract ID into `VITE_LENDING_CONTRACT_ID`.
5. Deploy the staking_pool contract (DeFindex-backed) and initialize it with its USDC token and vault.
6. Copy that contract ID into **both** `VITE_STAKING_CONTRACT_ID` (frontend) and `STAKING_CONTRACT_ID` (API). They must match.
7. If you redeploy any contract, update the value in `.env.local`.

### Local port

1. Use `PORT=3000` if you need a predictable local port.
2. If your environment already uses another port, you can change it.

## Architecture

Vyn has three layers: a React frontend (wallet-based auth), Vercel serverless API functions, and three Soroban smart contracts on Stellar Testnet.

- [Architecture overview](docs/architecture.md) — layers, components, contracts, and where to make common changes.
- [Core flows](docs/flows.md) — step-by-step walkthroughs of auth, deposit, scoring/minting, credit, and loan flows.
- [Deployment guide](docs/deployment.md) — local setup, Vercel deploy, rollback steps, and contract redeployment.
- [API reference](docs/api.md) — all endpoint contracts with request/response shapes and error codes.
- [Wallet providers & fallback routing](docs/wallets.md) — supported wallets, compatibility matrix, fallback order, and environment detection.
- [Contract migration & upgrade guide](docs/contracts/migration.md) — reproducible deploy, upgrade, and rollback steps for all three Soroban contracts.

## Notes For Collaborators

- Do not commit `.env.local`.
- Use `.env.example` as the reference for required variables.
- `PUBLIC_KEY_ADMIN` and `SECRET_KEY_ADMIN` must belong to the same account.
- Contract IDs are environment-specific and may change after redeployments.
