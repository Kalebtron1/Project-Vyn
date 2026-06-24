#!/usr/bin/env bash
# deploy_contracts.sh — full deploy + init sequence for all three Soroban contracts.
# Run from the repo root after setting the required environment variables.
#
# Required env vars:
#   ADMIN_SECRET          — deployer secret key (S...)
#   ADMIN_PUBLIC          — matching public key  (G...)
#   TOKEN_ADDRESS         — SAC del activo del staking_pool: el USDC del vault DeFindex.
#                           Debe ser el MISMO activo del vault.
#   VAULT_ADDRESS         — dirección del vault DeFindex (USDC) que respalda el staking_pool
#   TREASURY_ADDRESS      — wallet (G...) dueña de las ganancias por interés del lending.
#                           Única que podrá llamar `withdraw_interest`.
#
# Optional:
#   LENDING_TOKEN_ADDRESS — SAC del activo que PRESTA vinculo_lending. Default: SAC nativo
#                           de XLM en testnet. Es DISTINTO del USDC del staking_pool.
#   NETWORK               — defaults to "testnet"
#
# Usage:
#   export ADMIN_SECRET="S..."
#   export ADMIN_PUBLIC="G..."
#   export TOKEN_ADDRESS="C..."   # SAC del USDC del vault (staking_pool)
#   export VAULT_ADDRESS="CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN"
#   export TREASURY_ADDRESS="G..."
#   bash scripts/deploy_contracts.sh

set -euo pipefail

NETWORK="${NETWORK:-testnet}"
CONTRACTS_DIR="backend/contracts"
# SAC nativo de XLM en testnet (activo que presta vinculo_lending; distinto del USDC).
LENDING_TOKEN_ADDRESS="${LENDING_TOKEN_ADDRESS:-CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC}"

# ── Validate required vars ────────────────────────────────────────────────────
: "${ADMIN_SECRET:?Set ADMIN_SECRET before running this script}"
: "${ADMIN_PUBLIC:?Set ADMIN_PUBLIC before running this script}"
: "${TOKEN_ADDRESS:?Set TOKEN_ADDRESS before running this script}"
: "${VAULT_ADDRESS:?Set VAULT_ADDRESS (DeFindex vault) before running this script}"
: "${TREASURY_ADDRESS:?Set TREASURY_ADDRESS (treasury wallet for loan interest) before running this script}"

echo "==> Network: $NETWORK"
echo "==> Admin:   $ADMIN_PUBLIC"

# ── Helper: build + deploy + return contract ID ───────────────────────────────
deploy_contract() {
  local name="$1"
  local dir="$CONTRACTS_DIR/$name"

  echo ""
  echo "── Building $name ──"
  (cd "$dir" && cargo build --release --target wasm32-unknown-unknown --quiet)

  local wasm="$dir/target/wasm32-unknown-unknown/release/${name}.wasm"
  echo "── Deploying $name ──"
  stellar contract deploy \
    --wasm "$wasm" \
    --source "$ADMIN_SECRET" \
    --network "$NETWORK"
}

# ── Helper: upload wasm and return hash ───────────────────────────────────────
upload_wasm() {
  local name="$1"
  local dir="$CONTRACTS_DIR/$name"
  local wasm="$dir/target/wasm32-unknown-unknown/release/${name}.wasm"

  stellar contract upload \
    --wasm "$wasm" \
    --source "$ADMIN_SECRET" \
    --network "$NETWORK"
}

# ── 1. vinculo_sbt ────────────────────────────────────────────────────────────
SBT_CONTRACT_ID=$(deploy_contract "vinculo_sbt")
echo "SBT_CONTRACT_ID=$SBT_CONTRACT_ID"

stellar contract invoke \
  --id "$SBT_CONTRACT_ID" \
  --source "$ADMIN_SECRET" \
  --network "$NETWORK" \
  -- init \
  --admin "$ADMIN_PUBLIC"
echo "==> vinculo_sbt initialized"

# ── 2. staking_pool ───────────────────────────────────────────────────────────
STAKING_CONTRACT_ID=$(deploy_contract "staking_pool")
echo "STAKING_CONTRACT_ID=$STAKING_CONTRACT_ID"

stellar contract invoke \
  --id "$STAKING_CONTRACT_ID" \
  --source "$ADMIN_SECRET" \
  --network "$NETWORK" \
  -- init \
  --token "$TOKEN_ADDRESS" \
  --vault "$VAULT_ADDRESS"
echo "==> staking_pool initialized (token + DeFindex vault)"

# ── 3. vinculo_lending ────────────────────────────────────────────────────────
LENDING_CONTRACT_ID=$(deploy_contract "vinculo_lending")
echo "LENDING_CONTRACT_ID=$LENDING_CONTRACT_ID"

stellar contract invoke \
  --id "$LENDING_CONTRACT_ID" \
  --source "$ADMIN_SECRET" \
  --network "$NETWORK" \
  -- init_lending \
  --token "$LENDING_TOKEN_ADDRESS" \
  --sbt "$SBT_CONTRACT_ID" \
  --treasury "$TREASURY_ADDRESS"
echo "==> vinculo_lending initialized (XLM token + SBT + treasury)"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════"
echo " Deployment complete. Add to .env.local:"
echo "════════════════════════════════════════"
echo "NFT_CONTRACT_ID=$SBT_CONTRACT_ID"
echo "VITE_LENDING_CONTRACT_ID=$LENDING_CONTRACT_ID"
echo "VITE_STAKING_CONTRACT_ID=$STAKING_CONTRACT_ID"
echo "STAKING_CONTRACT_ID=$STAKING_CONTRACT_ID"
echo "VITE_TREASURY_ADDRESS=$TREASURY_ADDRESS"
echo "════════════════════════════════════════"
