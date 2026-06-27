#!/usr/bin/env bash
# harvest_keeper.sh — mantiene el rendimiento del apartado VIVO y VISIBLE durante la demo.
#
# Cada ciclo:
#   1. Lee el idle del vault (fetch_total_managed_funds). Si hay fondos sin invertir
#      (p.ej. tras un depósito nuevo desde la UI), los invierte en la estrategia
#      (rebalance Invest) — porque `deposit(invest=true)` NO auto-invierte.
#   2. Llama `strategy.harvest(--from <vault>)` (permissionless) para REALIZAR el
#      rendimiento acumulado en el precio de la share → `get_position` sube.
#
# Así, un usuario deposita en la app y ve su posición crecer sin pasos manuales.
#
# La estrategia fixed_apr acumula el yield en un balance aparte que solo pasa al
# principal con `harvest`. El admin (rebalance manager) firma el invest; harvest no
# exige rol. La estrategia debe tener USDC de reserva para pagar el yield al retirar.
#
# Env vars:
#   ADMIN_SECRET  — secret S... del admin (rebalance manager del vault)
#   ADMIN_PUBLIC  — public G... del admin (caller del rebalance)
#   VAULT         — vault DeFindex (default = el desplegado)
#   STRATEGY      — estrategia fixed_apr (default = la desplegada)
#   INTERVAL      — segundos entre ciclos (default 30)
#   NETWORK       — default testnet
#
# Uso:  ADMIN_SECRET=S... ADMIN_PUBLIC=G... bash scripts/harvest_keeper.sh

set -euo pipefail

NETWORK="${NETWORK:-testnet}"
INTERVAL="${INTERVAL:-30}"
VAULT="${VAULT:-CBPO3E7IFJRVP6MVNS4YJOVHEOEMNMUHV7AVAQ47IL53ERVCEJ6UIS76}"
STRATEGY="${STRATEGY:-CCVJC5C7RR7BWWYSAEDCOJFAV5M6X32WUDVRLC2M2LNABZTANIOCDKT7}"

: "${ADMIN_SECRET:?Set ADMIN_SECRET (admin/rebalance manager)}"
: "${ADMIN_PUBLIC:?Set ADMIN_PUBLIC (caller del rebalance)}"

echo "==> Keeper apartado — vault $VAULT, cada ${INTERVAL}s. Ctrl+C para parar."
while true; do
  TS=$(date '+%H:%M:%S' 2>/dev/null || echo "")

  # 1. Invertir idle nuevo (si lo hay) en la estrategia.
  IDLE=$(stellar contract invoke --id "$VAULT" --source "$ADMIN_SECRET" --network "$NETWORK" --send=no \
           -- fetch_total_managed_funds 2>/dev/null \
         | python -c "import sys,json; d=json.load(sys.stdin); print(d[0]['idle_amount'])" 2>/dev/null || echo "0")
  if [ -n "$IDLE" ] && [ "$IDLE" != "0" ]; then
    if stellar contract invoke --id "$VAULT" --source "$ADMIN_SECRET" --network "$NETWORK" \
         -- rebalance --caller "$ADMIN_PUBLIC" \
         --instructions "[ {\"Invest\":[\"$STRATEGY\", \"$IDLE\"]} ]" >/dev/null 2>&1; then
      echo "[$TS] invest OK — $IDLE stroops idle → estrategia."
    else
      echo "[$TS] invest falló (idle=$IDLE)."
    fi
  fi

  # 2. Realizar el rendimiento acumulado.
  if stellar contract invoke --id "$STRATEGY" --source "$ADMIN_SECRET" --network "$NETWORK" \
       -- harvest --from "$VAULT" >/dev/null 2>&1; then
    echo "[$TS] harvest OK — rendimiento realizado (get_position sube)."
  else
    echo "[$TS] harvest falló (reintentará)."
  fi

  sleep "$INTERVAL"
done
