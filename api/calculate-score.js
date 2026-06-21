import { createLogger } from "./_logger.js";
import { validateBody, calculateScoreBodySchema, reportValidationError } from "./validation.js";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const MIN_TX_REQUIRED = 3;
const HISTORY_LIMIT = 30;

/**
 * Scoring inputs that matter most (for contributors):
 *
 *  weightedVolume  — sum of deposit amounts discounted by age.
 *                    Uses a 30-day half-life decay: weight = 1 / (1 + daysAgo / 30).
 *                    This makes old and recent deposits contribute more evenly;
 *                    a single large recent deposit no longer dominates.
 *
 *  normalizedVolume — weightedVolume divided by totalDeposited so the score
 *                    reflects *consistency* rather than raw size.
 *                    Range: (0, 1].
 *
 *  retentionRate   — min(totalBalance / totalDeposited, 1).
 *                    Capped at 1 so a balance that grew beyond deposits
 *                    does not inflate the score.
 *
 *  activityFactor  — log10(txCount + 1). Rewards breadth of activity
 *                    without letting a flood of tiny transactions explode the score.
 *
 *  Final formula   — (normalizedVolume * retentionRate * activityFactor) * SCALE
 *                    SCALE = 100 so that a well-distributed history with full
 *                    retention and ~10 transactions lands near 100 pts (Plata/Oro).
 *
 *  Drain penalty   — if balance < 10 % of totalDeposited the score is cut by 80 %.
 *                    Unchanged from previous version.
 *
 * Tier thresholds (unchanged):
 *   >= 1000 → Platino (4)
 *   >= 500  → Diamante (3)
 *   >= 150  → Oro (2)
 *   >= 50   → Plata (1)
 *   < 50    → Bronce (0)
 */
function computeFinancialReputation(history, totalBalance) {
  if (history.length < MIN_TX_REQUIRED) {
    return {
      score: 0,
      tier: 0,
      tierName: "Bronce",
      eligibility: {
        minHistoryRequired: MIN_TX_REQUIRED,
        historyCount: history.length,
        isHistoryEligible: false,
        remainingForUnlock: MIN_TX_REQUIRED - history.length,
      },
    };
  }

  let totalDeposited = 0;
  let totalWithdrawn = 0;
  let weightedVolume = 0;
  const now = new Date();

  history.forEach((tx) => {
    const daysAgo = Math.max(0, (now - tx.date) / (1000 * 60 * 60 * 24));
    // Soft 30-day half-life decay — recent and older deposits both contribute meaningfully
    const timeWeight = 1 / (1 + daysAgo / 30);

    if (tx.type === "deposit") {
      totalDeposited += tx.amount;
      weightedVolume += tx.amount * timeWeight;
    } else {
      totalWithdrawn += tx.amount;
    }
  });

  // Normalize by total deposited so score reflects consistency, not raw size
  const normalizedVolume = totalDeposited > 0 ? weightedVolume / totalDeposited : 0;

  // Cap retention at 1 — a balance that grew beyond deposits should not inflate score
  const retentionRate = totalDeposited > 0 ? Math.min(totalBalance / totalDeposited, 1) : 0;

  // Logarithmic activity factor
  const activityFactor = Math.log10(history.length + 1);

  // SCALE chosen so a consistent user with ~10 txs and full retention scores ~100 pts
  const SCALE = 100;
  let score = normalizedVolume * retentionRate * activityFactor * SCALE;

  // Drain penalty: balance below 10 % of total deposited → 80 % score reduction
  if (totalDeposited > 0 && totalBalance < totalDeposited * 0.1) {
    score *= 0.2;
  }

  // Hard cap at Platino ceiling to prevent runaway scores
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
      historyCount: history.length,
      isHistoryEligible: true,
      remainingForUnlock: 0,
    },
    metrics: {
      retention: parseFloat(retentionRate.toFixed(2)),
      activity: parseFloat(activityFactor.toFixed(2)),
      volumeIn: totalDeposited,
      volumeOut: totalWithdrawn,
    },
  };
}

export { computeFinancialReputation };

async function getCleanHistory(userAddress) {
  try {
    const response = await fetch(
      `${HORIZON_URL}/accounts/${userAddress}/effects?limit=${HISTORY_LIMIT}&order=desc`
    );
    if (!response.ok) return [];

    const data = await response.json();

    return (data._embedded.records || [])
      .filter(
        (op) =>
          (op.type === "account_debited" ||
            op.type === "account_credited" ||
            op.type === "contract_credited") &&
          Number(op.amount) > 0
      )
      .map((op) => ({
        amount: parseFloat(op.amount),
        type:
          op.type === "account_credited" || op.type === "contract_credited"
            ? "deposit"
            : "withdrawal",
        date: new Date(op.created_at),
      }))
      .slice(0, HISTORY_LIMIT);
  } catch (e) {
    return [];
  }
}

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
  let clientTotalDeposited;

  try {
    const validated = validateBody(calculateScoreBodySchema, req.body || {});
    address = validated.address;
    clientTotalDeposited = validated.totalDeposited;
  } catch (error) {
    return reportValidationError(res, error);
  }

  log.info("calculate_score.start", { address });

  const t0 = Date.now();
  try {
    const history = await getCleanHistory(address);
    log.info("calculate_score.history_fetched", { address, count: history.length });

    let effectiveTotal = Number(clientTotalDeposited) || 0;
    if (!effectiveTotal || effectiveTotal <= 0) {
      try {
        const resp = await fetch(`${HORIZON_URL}/accounts/${address}`);
        if (resp.ok) {
          const acct = await resp.json();
          const native = (acct.balances || []).find(
            (b) => b.asset_type === "native"
          );
          effectiveTotal = Number(native?.balance) || effectiveTotal;
        }
      } catch (e) {
        log.warn("calculate_score.balance_fetch_failed", { address, err: e.message });
      }
    }

    const result = computeFinancialReputation(
      history,
      Math.max(0, Number(effectiveTotal) || 0)
    );

    // --- ANOMALY DETECTION ---
    // Normal range: score 0–2000. Scores above 2000 indicate abnormal volume/retention
    // and should be reviewed. Trigger: score > 2000 or retention > 5 (balance > 5x deposited).
    // NOTE: under the current bounded scoring (score capped at 1000, retention capped at 1)
    // these thresholds are dormant; revisit them with the planned scoring recalibration.
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
