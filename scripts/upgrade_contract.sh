#!/usr/bin/env bash
# upgrade_contract.sh — rebuild and upgrade a single deployed Soroban contract in-place.
# Preserves all on-chain storage (tiers, balances, loans).
#
# Required env vars:
#   ADMIN_SECRET      — deployer secret key (S...)
#   CONTRACT_ID       — ID of the contract to upgrade (C...)
#   CONTRACT_NAME     — one of: vinculo_sbt | staking_pool | vinculo_lending
#
# Optional:
#   NETWORK           — defaults to "testnet"
#
# Usage:
#   export ADMIN_SECRET="S..."
#   export CONTRACT_ID="C..."
#   export CONTRACT_NAME="vinculo_sbt"
#   bash scripts/upgrade_contract.sh

set -euo pipefail

NETWORK="${NETWORK:-testnet}"
CONTRACTS_DIR="backend/contracts"

: "${ADMIN_SECRET:?Set ADMIN_SECRET}"
: "${CONTRACT_ID:?Set CONTRACT_ID}"
: "${CONTRACT_NAME:?Set CONTRACT_NAME (vinculo_sbt | staking_pool | vinculo_lending)}"

DIR="$CONTRACTS_DIR/$CONTRACT_NAME"
WASM="$DIR/target/wasm32-unknown-unknown/release/${CONTRACT_NAME}.wasm"

echo "==> Upgrading $CONTRACT_NAME ($CONTRACT_ID) on $NETWORK"

# 1. Record current wasm hash for rollback reference
echo "── Current wasm hash (save for rollback) ──"
stellar contract info --id "$CONTRACT_ID" --network "$NETWORK" 2>/dev/null || true

# 2. Build
echo "── Building $CONTRACT_NAME ──"
(cd "$DIR" && cargo build --release --target wasm32-unknown-unknown --quiet)

# 3. Upload new wasm
echo "── Uploading wasm ──"
WASM_HASH=$(stellar contract upload \
  --wasm "$WASM" \
  --source "$ADMIN_SECRET" \
  --network "$NETWORK")
echo "New wasm hash: $WASM_HASH"

# 4. Upgrade
echo "── Upgrading contract ──"
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_SECRET" \
  --network "$NETWORK" \
  -- upgrade \
  --new_wasm_hash "$WASM_HASH"

echo "==> $CONTRACT_NAME upgraded successfully"
echo ""
echo "To roll back, re-upload the previous wasm and run:"
echo "  stellar contract invoke --id $CONTRACT_ID --source \$ADMIN_SECRET --network $NETWORK -- upgrade --new_wasm_hash <OLD_HASH>"
