#!/usr/bin/env bash
# smoke_test_staking.sh — prueba end-to-end del staking_pool respaldado por DeFindex en testnet.
#
# Flujo: verifica el vault → deposita → lee get_position → retira, imprimiendo tx hashes.
#
# Requisitos:
#   - stellar CLI instalado y una identidad fondeada (alias en SOURCE).
#   - La identidad debe tener el activo USDC del vault (trustline + saldo). El activo es
#     USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56
#     (SAC: CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU)
#
# Env vars:
#   SOURCE                — alias de identidad stellar (p.ej. "vyn_smoke") o secret key S...
#   STAKING_CONTRACT_ID   — id del staking_pool ya desplegado e inicializado
#   AMOUNT                — monto en stroops (7 decimales). Default 10000000 (= 1 USDC)
#   VAULT_ADDRESS         — default: vault USDC de DeFindex en testnet
#   TOKEN_ADDRESS         — default: SAC del USDC del vault
#   NETWORK               — default: testnet
#
# Uso:
#   export SOURCE="vyn_smoke"
#   export STAKING_CONTRACT_ID="C..."
#   bash scripts/smoke_test_staking.sh

set -euo pipefail

NETWORK="${NETWORK:-testnet}"
AMOUNT="${AMOUNT:-10000000}"
VAULT_ADDRESS="${VAULT_ADDRESS:-CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN}"
TOKEN_ADDRESS="${TOKEN_ADDRESS:-CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU}"

: "${SOURCE:?Set SOURCE (stellar identity alias or secret key)}"
: "${STAKING_CONTRACT_ID:?Set STAKING_CONTRACT_ID (deployed + initialized staking_pool)}"

USER_ADDR=$(stellar keys address "$SOURCE" 2>/dev/null || echo "$SOURCE")

echo "==> Network:        $NETWORK"
echo "==> Staking pool:   $STAKING_CONTRACT_ID"
echo "==> Vault:          $VAULT_ADDRESS"
echo "==> Token (USDC):   $TOKEN_ADDRESS"
echo "==> User:           $USER_ADDR"
echo "==> Amount:         $AMOUNT stroops"

echo ""
echo "── 0. Verificar que el vault está vivo (get_assets) ──"
stellar contract invoke --id "$VAULT_ADDRESS" --source "$SOURCE" --network "$NETWORK" -- get_assets

echo ""
echo "── 1. Posición inicial (get_position) ──"
stellar contract invoke --id "$STAKING_CONTRACT_ID" --source "$SOURCE" --network "$NETWORK" -- get_position --user "$USER_ADDR"

echo ""
echo "── 2. Depositar $AMOUNT (deposit) ──"
stellar contract invoke --send=yes --id "$STAKING_CONTRACT_ID" --source "$SOURCE" --network "$NETWORK" -- deposit --user "$USER_ADDR" --amount "$AMOUNT"

echo ""
echo "── 3. Posición tras depósito (get_position) ──"
stellar contract invoke --id "$STAKING_CONTRACT_ID" --source "$SOURCE" --network "$NETWORK" -- get_position --user "$USER_ADDR"

echo ""
echo "── 4. Retirar todo (withdraw, monto alto = todo) ──"
stellar contract invoke --send=yes --id "$STAKING_CONTRACT_ID" --source "$SOURCE" --network "$NETWORK" -- withdraw --user "$USER_ADDR" --amount 1000000000000

echo ""
echo "── 5. Posición final (get_position) ──"
stellar contract invoke --id "$STAKING_CONTRACT_ID" --source "$SOURCE" --network "$NETWORK" -- get_position --user "$USER_ADDR"

echo ""
echo "✅ Smoke-test completado. Revisa los tx hashes arriba en https://stellar.expert/explorer/testnet"
