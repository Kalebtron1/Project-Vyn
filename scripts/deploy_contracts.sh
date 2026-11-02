#!/usr/bin/env bash
# deploy_contracts.sh — build and deploy the three Soroban contracts.
# Each constructor runs in the deploy transaction, so there is no init window.
# Run from the repo root.
#
# Required env vars:
#   STELLAR_ACCOUNT   — deployer identity or secret. Read by the Stellar CLI from
#                       the environment so it never appears in the command line.
#                       The deployer keeps no power over the contracts.
#   ADMIN_PUBLIC      — governance account (G...), a multisig outside this machine
#   PAUSER_PUBLIC     — account that can pause, but not unpause
#   MINTER_PUBLIC     — account that can write SBT tiers
#   TREASURY_PUBLIC   — account that receives loan interest
#   TOKEN_ADDRESS     — USDC SAC. Must be the same asset as the vault
#   VAULT_ADDRESS     — DeFindex vault (USDC) behind staking_pool
#
# Optional:
#   LENDING_TOKEN_ADDRESS — asset lent by vinculo_lending. Default: TOKEN_ADDRESS
#   METADATA_BASE_URL     — base URL of the tier metadata JSON files
#   NETWORK               — defaults to "testnet"
#
# Create the vault first with scripts/create_vault.sh.

set -euo pipefail

NETWORK="${NETWORK:-testnet}"
CONTRACTS_DIR="backend/contracts"
METADATA_BASE_URL="${METADATA_BASE_URL:-https://raw.githubusercontent.com/Kalebtron1/Project-Vyn/main/metadata}"

: "${STELLAR_ACCOUNT:?Set STELLAR_ACCOUNT (deployer) before running this script}"
: "${ADMIN_PUBLIC:?Set ADMIN_PUBLIC before running this script}"
: "${PAUSER_PUBLIC:?Set PAUSER_PUBLIC before running this script}"
: "${MINTER_PUBLIC:?Set MINTER_PUBLIC before running this script}"
: "${TREASURY_PUBLIC:?Set TREASURY_PUBLIC before running this script}"
: "${TOKEN_ADDRESS:?Set TOKEN_ADDRESS (USDC SAC) before running this script}"
: "${VAULT_ADDRESS:?Set VAULT_ADDRESS (DeFindex vault) before running this script}"
LENDING_TOKEN_ADDRESS="${LENDING_TOKEN_ADDRESS:-$TOKEN_ADDRESS}"

echo "==> Network: $NETWORK" >&2
echo "==> Admin:   $ADMIN_PUBLIC" >&2

echo "── Building contracts ──" >&2
(cd "$CONTRACTS_DIR" && stellar contract build) >&2

# Prints only the contract ID on stdout. Constructor args go after the name.
deploy_contract() {
  local name="$1"
  shift
  echo "── Deploying $name ──" >&2
  stellar contract deploy \
    --wasm "$CONTRACTS_DIR/target/wasm32v1-none/release/${name}.wasm" \
    --network "$NETWORK" \
    -- "$@"
}

URIS="[\"$METADATA_BASE_URL/bronce.json\",\"$METADATA_BASE_URL/plata.json\",\"$METADATA_BASE_URL/oro.json\",\"$METADATA_BASE_URL/diamante.json\",\"$METADATA_BASE_URL/platino.json\"]"

SBT_CONTRACT_ID=$(deploy_contract vinculo_sbt \
  --admin "$ADMIN_PUBLIC" \
  --pauser "$PAUSER_PUBLIC" \
  --minter "$MINTER_PUBLIC" \
  --uris "$URIS")

STAKING_CONTRACT_ID=$(deploy_contract staking_pool \
  --admin "$ADMIN_PUBLIC" \
  --pauser "$PAUSER_PUBLIC" \
  --token "$TOKEN_ADDRESS" \
  --vault "$VAULT_ADDRESS")

LENDING_CONTRACT_ID=$(deploy_contract vinculo_lending \
  --admin "$ADMIN_PUBLIC" \
  --pauser "$PAUSER_PUBLIC" \
  --token "$LENDING_TOKEN_ADDRESS" \
  --sbt "$SBT_CONTRACT_ID" \
  --treasury "$TREASURY_PUBLIC")

echo "" >&2
echo "════════════════════════════════════════" >&2
echo " Deployment complete. Environment values:" >&2
echo "════════════════════════════════════════" >&2
echo "NFT_CONTRACT_ID=$SBT_CONTRACT_ID"
echo "VITE_LENDING_CONTRACT_ID=$LENDING_CONTRACT_ID"
echo "VITE_STAKING_CONTRACT_ID=$STAKING_CONTRACT_ID"
echo "STAKING_CONTRACT_ID=$STAKING_CONTRACT_ID"
echo "VITE_TREASURY_ADDRESS=$TREASURY_PUBLIC"
