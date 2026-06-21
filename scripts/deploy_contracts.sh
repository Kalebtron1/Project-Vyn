#!/usr/bin/env bash
# deploy_contracts.sh — full deploy + init sequence for all three Soroban contracts.
# Run from the repo root after setting the required environment variables.
#
# Required env vars:
#   ADMIN_SECRET   — deployer secret key (S...)
#   ADMIN_PUBLIC   — matching public key  (G...)
#   TOKEN_ADDRESS  — SAC address of the token used by staking_pool and vinculo_lending
#
# Optional:
#   NETWORK        — defaults to "testnet"
#
# Usage:
#   export ADMIN_SECRET="S..."
#   export ADMIN_PUBLIC="G..."
#   export TOKEN_ADDRESS="C..."
#   bash scripts/deploy_contracts.sh

set -euo pipefail

NETWORK="${NETWORK:-testnet}"
CONTRACTS_DIR="backend/contracts"

# ── Validate required vars ────────────────────────────────────────────────────
: "${ADMIN_SECRET:?Set ADMIN_SECRET before running this script}"
: "${ADMIN_PUBLIC:?Set ADMIN_PUBLIC before running this script}"
: "${TOKEN_ADDRESS:?Set TOKEN_ADDRESS before running this script}"

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
  --token "$TOKEN_ADDRESS"
echo "==> staking_pool initialized"

# ── 3. vinculo_lending ────────────────────────────────────────────────────────
LENDING_CONTRACT_ID=$(deploy_contract "vinculo_lending")
echo "LENDING_CONTRACT_ID=$LENDING_CONTRACT_ID"

stellar contract invoke \
  --id "$LENDING_CONTRACT_ID" \
  --source "$ADMIN_SECRET" \
  --network "$NETWORK" \
  -- init_lending \
  --token "$TOKEN_ADDRESS" \
  --sbt "$SBT_CONTRACT_ID"
echo "==> vinculo_lending initialized"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════"
echo " Deployment complete. Add to .env.local:"
echo "════════════════════════════════════════"
echo "NFT_CONTRACT_ID=$SBT_CONTRACT_ID"
echo "VITE_LENDING_CONTRACT_ID=$LENDING_CONTRACT_ID"
echo "# STAKING_CONTRACT_ID=$STAKING_CONTRACT_ID"
echo "════════════════════════════════════════"
