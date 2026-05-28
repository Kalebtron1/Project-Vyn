# Project Vyn

Project Vyn is a Vite + React application backed by Supabase and Stellar/Soroban contract calls.

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

### What you need to replicate

- A Supabase project or access to the shared test project.
- A Stellar testnet admin account for `SECRET_KEY_ADMIN` and `PUBLIC_KEY_ADMIN`.
- The deployed Soroban contract IDs for `NFT_CONTRACT_ID` and `VITE_LENDING_CONTRACT_ID`.

If you do not have those values yet, you can still read the code and work on UI or docs changes, but wallet, scoring, and minting flows will not work end to end.

## Environment Variables

The project uses the following variables:

- `VITE_SUPABASE_PROJECT_ID`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `PUBLIC_KEY_ADMIN`
- `SECRET_KEY_ADMIN`
- `NFT_CONTRACT_ID`
- `VITE_LENDING_CONTRACT_ID`
- `PORT`

`VERCEL_OIDC_TOKEN` is created by Vercel for deployment workflows and is not required for normal local development.

## How To Get Each Value

### Supabase values

1. Open your project in the Supabase dashboard.
2. Go to Project Settings > General and copy the Project ID for `VITE_SUPABASE_PROJECT_ID`.
3. Go to Project Settings > API.
4. Copy the Project URL into `VITE_SUPABASE_URL`.
5. Copy the `anon` / publishable key into `VITE_SUPABASE_PUBLISHABLE_KEY`.

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
5. If you redeploy either contract, update the value in `.env.local`.

### Local port

1. Use `PORT=3000` if you need a predictable local port.
2. If your environment already uses another port, you can change it.

## Architecture

Vyn has four layers: a React frontend, Vercel serverless API functions, Supabase for auth and profiles, and three Soroban smart contracts on Stellar Testnet.

- [Architecture overview](docs/architecture.md) — layers, components, contracts, and where to make common changes.
- [Core flows](docs/flows.md) — step-by-step walkthroughs of auth, deposit, scoring/minting, credit, and loan flows.
- [Contract migration & upgrade guide](docs/contracts/migration.md) — reproducible deploy, upgrade, and rollback steps for all three Soroban contracts.

## Notes For Collaborators

- Do not commit `.env.local`.
- Use `.env.example` as the reference for required variables.
- `PUBLIC_KEY_ADMIN` and `SECRET_KEY_ADMIN` must belong to the same account.
- Contract IDs are environment-specific and may change after redeployments.
