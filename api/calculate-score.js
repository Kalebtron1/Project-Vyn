import { createLogger } from "./_logger.mjs";
import { validateBody, calculateScoreBodySchema, reportValidationError } from "./validation.mjs";
import { computeFinancialReputation, getOnChainAggregates } from "./_scoring-core.mjs";

// staking_pool respaldado por DeFindex. El score se calcula con los contadores
// REALES que el contrato mantiene on-chain (no con effects de Horizon). La lógica
// vive en ./_scoring-core.mjs para que la comparta el server Express de dev local
// (backend/server.js) y no vuelvan a divergir las dos implementaciones.
const CONTRACT_ID = process.env.STAKING_CONTRACT_ID;

// Consulta agregados on-chain (Soroban RPC); el default de 10 s del plan hobby
// puede cortarla y arrastrar al mint que la encadena. 60 s es el máx en hobby.
export const config = { maxDuration: 60 };

// Re-export para los tests de regresión (src/test/calculate-score.test.ts) y para
// cualquier consumidor que ya importaba desde aquí.
export { computeFinancialReputation };

export default async function handler(req, res) {
  const log = createLogger(req);

  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  let address;

  try {
    const validated = validateBody(calculateScoreBodySchema, req.body || {});
    address = validated.address;
    // `totalDeposited` del body se ignora: la fuente de verdad es el contrato.
  } catch (error) {
    return reportValidationError(res, error);
  }

  log.info("calculate_score.start", { address, contractId: CONTRACT_ID });

  const t0 = Date.now();
  try {
    const aggregates = await getOnChainAggregates(address, { contractId: CONTRACT_ID });
    // Incluimos el contrato leído para poder diagnosticar de un vistazo si los
    // agregados vienen del contrato esperado (y no de uno viejo por env desfasado).
    log.info("calculate_score.aggregates", { address, contractId: CONTRACT_ID, ...aggregates });

    const result = computeFinancialReputation(aggregates);

    // --- ANOMALY DETECTION ---
    // Bajo el scoring acotado (score <= 1000, retención <= 1) estos umbrales quedan
    // latentes; se revisarán con la recalibración del scoring.
    const SCORE_ANOMALY_THRESHOLD = 2000;
    const RETENTION_ANOMALY_THRESHOLD = 5;
    if (
      result.score > SCORE_ANOMALY_THRESHOLD ||
      (result.metrics && result.metrics.retention > RETENTION_ANOMALY_THRESHOLD)
    ) {
      log.warn("calculate_score.anomaly", {
        address,
        score: result.score,
        retention: result.metrics?.retention,
      });
      result.anomaly = true;
    }

    log.info("calculate_score.done", {
      address,
      score: result.score,
      tier: result.tier,
      tierName: result.tierName,
      anomaly: result.anomaly === true,
    });

    const latencyMs = Date.now() - t0;
    // METRIC: calculate-score latency and conversion (tier >= 1 = eligible user)
    console.log(`[metric] calculate-score latency=${latencyMs}ms tier=${result.tier} eligible=${result.tier >= 1}`);

    return res.status(200).json(result);
  } catch (error) {
    log.error("calculate_score.error", { address, err: error.message });
    const latencyMs = Date.now() - t0;
    // METRIC: calculate-score failure
    console.log(`[metric] calculate-score latency=${latencyMs}ms error="${error.message}"`);
    return res.status(500).json({ error: error.message });
  }
}
