// Núcleo de scoring de reputación — ÚNICA fuente de verdad, compartida por:
//   - api/calculate-score.js          (Vercel serverless, ESM)
//   - backend/server.js               (Express local dev, CommonJS → `await import()`)
//
// El score se calcula con los contadores REALES que el staking_pool mantiene
// on-chain (get_total_deposited / get_total_withdrawn / get_position / get_tx_count),
// NO con effects de Horizon. El enfoque por Horizon clasificaba mal los depósitos
// (al depositar la cuenta del usuario se DEBITA, y eso se contaba como "retiro") y
// además contaba interacciones con CUALQUIER contrato de la cuenta, por lo que un
// contrato recién desplegado seguía mostrando historial viejo. Mantener esta lógica
// en un solo módulo evita que local y producción vuelvan a divergir.

import {
  rpc,
  TransactionBuilder,
  Networks,
  Operation,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
} from "@stellar/stellar-sdk";

const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
export const MIN_TX_REQUIRED = 3;

/**
 * Reputación financiera a partir de los agregados on-chain del staking_pool.
 *
 * Entradas (todas leídas del contrato, no de Horizon):
 *   totalDeposited — ingreso acumulado del usuario (get_total_deposited).
 *   totalWithdrawn — retiro acumulado del usuario (get_total_withdrawn).
 *   position       — valor redimible en vivo (get_position) = principal + rendimiento real.
 *   txCount        — nº de operaciones (get_tx_count) → factor de actividad.
 *
 *  retentionRate  — min(position / totalDeposited, 1). Capado a 1 para que el
 *                   rendimiento no infle el score por encima de retención plena.
 *  activityFactor — log10(txCount + 1). Premia la actividad sin que un montón de
 *                   micro-operaciones dispare el score.
 *  normalizedVolume — 1 cuando hay volumen depositado. El ponderado temporal por
 *                   depósito (decay de 30 días) no es derivable de los agregados
 *                   on-chain; se reintroducirá en el rediseño "hybrid scoring".
 *
 *  Fórmula final  — (normalizedVolume * retentionRate * activityFactor) * SCALE.
 *  Penalización por drenaje — si position < 10 % de totalDeposited, score *= 0.2.
 *
 * Umbrales de tier (sin cambios):
 *   >= 1000 → Platino (4) · >= 500 → Diamante (3) · >= 150 → Oro (2)
 *   >= 50   → Plata (1)   · < 50  → Bronce (0)
 */
export function computeFinancialReputation({ totalDeposited, totalWithdrawn, position, txCount }) {
  const deposited = Math.max(0, Number(totalDeposited) || 0);
  const withdrawn = Math.max(0, Number(totalWithdrawn) || 0);
  const balance = Math.max(0, Number(position) || 0);
  const count = Math.max(0, Math.floor(Number(txCount) || 0));

  if (count < MIN_TX_REQUIRED) {
    return {
      score: 0,
      tier: 0,
      tierName: "Bronce",
      eligibility: {
        minHistoryRequired: MIN_TX_REQUIRED,
        historyCount: count,
        isHistoryEligible: false,
        remainingForUnlock: MIN_TX_REQUIRED - count,
      },
    };
  }

  // Consistencia de volumen — sin fechas por-tx on-chain, vale 1 si hubo depósitos.
  const normalizedVolume = deposited > 0 ? 1 : 0;

  // Retención: posición viva vs. ingreso acumulado, capada a 1.
  const retentionRate = deposited > 0 ? Math.min(balance / deposited, 1) : 0;

  // Actividad logarítmica.
  const activityFactor = Math.log10(count + 1);

  // SCALE elegido para que un usuario consistente con ~10 tx y retención plena ronde ~100 pts.
  const SCALE = 100;
  let score = normalizedVolume * retentionRate * activityFactor * SCALE;

  // Penalización por drenaje: balance por debajo del 10 % de lo depositado → -80 %.
  if (deposited > 0 && balance < deposited * 0.1) {
    score *= 0.2;
  }

  // Tope duro en el techo de Platino para evitar scores desbocados.
  score = Math.min(score, 1000);

  let tier = 0;
  let tierName = "Bronce";
  if (score >= 1000) { tier = 4; tierName = "Platino"; }
  else if (score >= 500) { tier = 3; tierName = "Diamante"; }
  else if (score >= 150) { tier = 2; tierName = "Oro"; }
  else if (score >= 50)  { tier = 1; tierName = "Plata"; }

  return {
    score: parseFloat(score.toFixed(2)),
    tier,
    tierName,
    eligibility: {
      minHistoryRequired: MIN_TX_REQUIRED,
      historyCount: count,
      isHistoryEligible: true,
      remainingForUnlock: 0,
    },
    metrics: {
      retention: parseFloat(retentionRate.toFixed(2)),
      activity: parseFloat(activityFactor.toFixed(2)),
      volumeIn: deposited,
      volumeOut: withdrawn,
    },
  };
}

// Lee los contadores del staking_pool por simulación de Soroban (mismo patrón que
// api/get-user-data.js). Devuelve los agregados ya convertidos a unidades del token.
// `contractId` es OBLIGATORIO: sin él no hay forma de saber qué contrato leer, y leer
// uno equivocado (o ninguno) es justo lo que mostraba historial de un contrato viejo.
export async function getOnChainAggregates(userAddress, { contractId, rpcUrl = DEFAULT_RPC_URL } = {}) {
  if (!contractId) {
    throw new Error("STAKING_CONTRACT_ID no configurado");
  }
  const server = new rpc.Server(rpcUrl);

  let account;
  try {
    account = await server.getAccount(userAddress);
  } catch (e) {
    // Cuenta no fondeada en testnet → sin posición ni historial.
    return { totalDeposited: 0, totalWithdrawn: 0, position: 0, txCount: 0 };
  }

  const readContract = async (fnName) => {
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: contractId,
          function: fnName,
          args: [nativeToScVal(userAddress, { type: "address" })],
        })
      )
      .setTimeout(30)
      .build();

    const response = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationSuccess(response) && response.result) {
      return scValToNative(response.result.retval);
    }
    return 0;
  };

  const [depositedRaw, withdrawnRaw, positionRaw, txCountRaw] = await Promise.all([
    readContract("get_total_deposited"),
    readContract("get_total_withdrawn"),
    readContract("get_position"),
    readContract("get_tx_count"),
  ]);

  return {
    totalDeposited: Number(depositedRaw) / 10000000,
    totalWithdrawn: Number(withdrawnRaw) / 10000000,
    position: Number(positionRaw) / 10000000,
    txCount: Number(txCountRaw) || 0,
  };
}
