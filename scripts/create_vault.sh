#!/usr/bin/env bash
# create_vault.sh — crea NUESTRO vault DeFindex (vía el factory oficial) respaldado
# por la estrategia `fixed_apr` de DeFindex, que genera rendimiento real y visible
# en testnet a un APR configurable. Reproduce el despliegue del apartado de ahorro.
#
# Flujo:
#   1. Construye y despliega la estrategia fixed_apr (asset=USDC, apr_bps configurable).
#   2. Crea el vault vía factory.create_defindex_vault (roles=admin, fee=0, 1 asset/1 strat).
#   3. Imprime las direcciones para enchufarlas al staking_pool (init/set_vault).
#
# Tras crear el vault: despliega/inicializa el staking_pool apuntando a él
# (deploy_contracts.sh) y, en cada depósito, invierte el idle en la estrategia:
#   stellar contract invoke --id <VAULT> --source <ADMIN> --network testnet -- \
#     rebalance --caller <ADMIN_PUB> --instructions '[ {"Invest":["<STRAT>", "<amount>"]} ]'
#
# Requisitos: stellar CLI, repo paltalabs/defindex clonado (para el wasm de fixed_apr).
#
# Env vars:
#   ADMIN_SECRET   — secret S... del admin/manager del vault
#   ADMIN_PUBLIC   — public G... del admin (roles del vault)
#   USDC_SAC       — SAC del USDC subyacente (mismo activo que usa el staking_pool)
#   DEFINDEX_DIR   — ruta al repo paltalabs/defindex clonado (apps/contracts dentro)
#   APR_BPS        — APR en basis points (default 50000000 ≈ 1%/min sobre 10 USDC)
#   FACTORY        — factory DeFindex testnet (default abajo)
#   SOROSWAP_ROUTER— router Soroswap testnet (default abajo)
#   NETWORK        — default testnet

set -euo pipefail

NETWORK="${NETWORK:-testnet}"
APR_BPS="${APR_BPS:-50000000}"
FACTORY="${FACTORY:-CDSCWE4GLNBYYTES2OCYDFQA2LLY4RBIAX6ZI32VSUXD7GO6HRPO4A32}"
SOROSWAP_ROUTER="${SOROSWAP_ROUTER:-CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD}"

: "${ADMIN_SECRET:?Set ADMIN_SECRET}"
: "${ADMIN_PUBLIC:?Set ADMIN_PUBLIC}"
: "${USDC_SAC:?Set USDC_SAC (SAC del USDC subyacente)}"
: "${DEFINDEX_DIR:?Set DEFINDEX_DIR (repo paltalabs/defindex clonado)}"

echo "==> Network: $NETWORK | APR_BPS: $APR_BPS"

echo "── 1. Build + deploy fixed_apr strategy ──"
( cd "$DEFINDEX_DIR/apps/contracts" && cargo build -p fixed_apr_strategy --release --target wasm32-unknown-unknown )
WASM="$DEFINDEX_DIR/apps/contracts/target/wasm32-unknown-unknown/release/fixed_apr_strategy.wasm"
STRAT=$(stellar contract deploy --wasm "$WASM" --source "$ADMIN_SECRET" --network "$NETWORK" \
  -- --asset "$USDC_SAC" --init_args "[{\"u32\":$APR_BPS}]" 2>/dev/null | grep -oE 'C[A-Z2-7]{55}' | tail -1)
echo "STRATEGY=$STRAT"

echo "── 2. create_defindex_vault ──"
VAULT=$(stellar contract invoke --id "$FACTORY" --source "$ADMIN_SECRET" --network "$NETWORK" -- create_defindex_vault \
  --roles "{ \"0\": \"$ADMIN_PUBLIC\", \"1\": \"$ADMIN_PUBLIC\", \"2\": \"$ADMIN_PUBLIC\", \"3\": \"$ADMIN_PUBLIC\" }" \
  --vault_fee 0 \
  --assets "[ { \"address\": \"$USDC_SAC\", \"strategies\": [ { \"address\": \"$STRAT\", \"name\": \"FixApr\", \"paused\": false } ] } ]" \
  --soroswap_router "$SOROSWAP_ROUTER" \
  --name_symbol "{ \"name\": \"Vyn USDC Vault\", \"symbol\": \"vUSDC\" }" \
  --upgradable true 2>/dev/null | grep -oE 'C[A-Z2-7]{55}' | tail -1)

echo ""
echo "════════════════════════════════════════"
echo " STRATEGY (fixed_apr) = $STRAT"
echo " VAULT (DeFindex)     = $VAULT"
echo "════════════════════════════════════════"
echo " Úsalo en el init del staking_pool (--vault) y en src/stellar/contracts.ts (VAULT_ID)."
