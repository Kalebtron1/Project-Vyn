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
#   TREASURY_PUBLIC   — account that receives loan interest
#   TOKEN_ADDRESS     — USDC SAC. Must be the same asset as the vault
#   VAULT_ADDRESS     — DeFindex vault (USDC) behind staking_pool
#
# Optional:
#   MIN_COUNTED_DEPOSIT   — smallest deposit that counts for reputation, in stroops.
#                           Default: 100000000 (10 USDC)
#   SECONDS_PER_MONTH     — length of a loan month. Default: 2592000 (30 days)
#   GRACE_PERIOD          — seconds after the due date before liquidation.
#                           Default: 604800 (7 days)
#   REPUTATION_DAY_SECONDS — length of a reputation day. Default: 86400. Lower it
#                           only for demos
#   METADATA_BASE_URL     — base URL of the tier metadata JSON files
#   NETWORK               — defaults to "testnet"
#
# Create the vault first with scripts/create_vault.sh. The loan terms below are
# the approved values; the admin can change them later with set_config.
#
# After deploying, the admin must:
#   1. Grant the "lending" role on staking_pool to vinculo_lending, or loans fail.
#   2. Call set_lending on vinculo_sbt, or refresh_tier and preview_tier fail.

set -euo pipefail

NETWORK="${NETWORK:-testnet}"
CONTRACTS_DIR="backend/contracts"
METADATA_BASE_URL="${METADATA_BASE_URL:-https://raw.githubusercontent.com/Kalebtron1/Project-Vyn/main/metadata}"

: "${STELLAR_ACCOUNT:?Set STELLAR_ACCOUNT (deployer) before running this script}"
: "${ADMIN_PUBLIC:?Set ADMIN_PUBLIC before running this script}"
: "${PAUSER_PUBLIC:?Set PAUSER_PUBLIC before running this script}"
: "${TREASURY_PUBLIC:?Set TREASURY_PUBLIC before running this script}"
: "${TOKEN_ADDRESS:?Set TOKEN_ADDRESS (USDC SAC) before running this script}"
: "${VAULT_ADDRESS:?Set VAULT_ADDRESS (DeFindex vault) before running this script}"
MIN_COUNTED_DEPOSIT="${MIN_COUNTED_DEPOSIT:-100000000}"
SECONDS_PER_MONTH="${SECONDS_PER_MONTH:-2592000}"
GRACE_PERIOD="${GRACE_PERIOD:-604800}"
REPUTATION_DAY_SECONDS="${REPUTATION_DAY_SECONDS:-86400}"

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

STAKING_CONTRACT_ID=$(deploy_contract staking_pool \
  --admin "$ADMIN_PUBLIC" \
  --pauser "$PAUSER_PUBLIC" \
  --token "$TOKEN_ADDRESS" \
  --vault "$VAULT_ADDRESS" \
  --min_counted_deposit "$MIN_COUNTED_DEPOSIT")

# Amounts in stroops: 10, 50, 200 and 1,000 USDC.
tier_rule() {
  local balance="$1" days="$2" deposits="$3" on_time="$4" allow_defaults="$5"
  echo "{\"min_balance\":\"$balance\",\"min_seconds\":$((days * REPUTATION_DAY_SECONDS)),\"min_valid_deposits\":$deposits,\"min_repaid_on_time\":$on_time,\"allow_defaults\":$allow_defaults}"
}
REPUTATION_CONFIG="{\"plata\":$(tier_rule 100000000 30 3 0 true),\"oro\":$(tier_rule 500000000 90 3 1 true),\"diamante\":$(tier_rule 2000000000 180 3 3 false),\"platino\":$(tier_rule 10000000000 365 3 6 false),\"default_cooldown\":$((90 * REPUTATION_DAY_SECONDS))}"

SBT_CONTRACT_ID=$(deploy_contract vinculo_sbt \
  --admin "$ADMIN_PUBLIC" \
  --pauser "$PAUSER_PUBLIC" \
  --savings "$STAKING_CONTRACT_ID" \
  --config "$REPUTATION_CONFIG" \
  --uris "$URIS")

# Amounts in stroops: 100, 250, 750 and 2,000 USDC.
LOAN_CONFIG="{\"apy_bps\":1200,\"seconds_per_month\":$SECONDS_PER_MONTH,\"grace_period\":$GRACE_PERIOD,\
\"plata\":{\"ltv_bps\":5000,\"max_principal\":\"1000000000\"},\
\"oro\":{\"ltv_bps\":6000,\"max_principal\":\"2500000000\"},\
\"diamante\":{\"ltv_bps\":7000,\"max_principal\":\"7500000000\"},\
\"platino\":{\"ltv_bps\":8000,\"max_principal\":\"20000000000\"}}"

LENDING_CONTRACT_ID=$(deploy_contract vinculo_lending \
  --admin "$ADMIN_PUBLIC" \
  --pauser "$PAUSER_PUBLIC" \
  --savings "$STAKING_CONTRACT_ID" \
  --sbt "$SBT_CONTRACT_ID" \
  --treasury "$TREASURY_PUBLIC" \
  --config "$LOAN_CONFIG")

echo "" >&2
echo "════════════════════════════════════════" >&2
echo " Deployment complete. Environment values:" >&2
echo "════════════════════════════════════════" >&2
echo "NFT_CONTRACT_ID=$SBT_CONTRACT_ID"
echo "VITE_LENDING_CONTRACT_ID=$LENDING_CONTRACT_ID"
echo "VITE_STAKING_CONTRACT_ID=$STAKING_CONTRACT_ID"
echo "STAKING_CONTRACT_ID=$STAKING_CONTRACT_ID"
echo "VITE_TREASURY_ADDRESS=$TREASURY_PUBLIC"
