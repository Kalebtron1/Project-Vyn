/**
 * scripts/stress-test.js
 *
 * Deterministic fixture for the financial-reputation scoring engine.
 * Runs entirely in-process — no network calls, no env vars required.
 *
 * Usage:
 *   node scripts/stress-test.js
 *   # or via npm:
 *   npm run test:stress
 *
 * Scoring formula (from api/_scoring-core.mjs):
 *   volumeFactor   = min(1 + sqrt(totalDeposited / 100), 10)
 *   retentionRate  = min(position / totalDeposited, 1)
 *   activityFactor = log10(txCount + 1)
 *   score          = min(volumeFactor * retentionRate * activityFactor * 100, 1000)
 *   drain penalty  : if position < 10% of totalDeposited -> score * 0.2
 *
 * Tier thresholds:
 *   Plata >= 50 · Oro >= 150 · Diamante >= 500 · Platino >= 1000
 */

import { computeFinancialReputation } from "../api/calculate-score.js";

const SCENARIOS = [
  {
    name: "insufficient_history",
    description: "Only 2 transactions — below the 3-tx minimum",
    input: { totalDeposited: 1000, totalWithdrawn: 0, position: 1000, txCount: 2 },
    expect: { tier: 0, tierName: "Bronce", isHistoryEligible: false },
  },
  {
    name: "plata_boundary",
    description: "Initial saver (100 USDC across 3 deposits, full retention) -> Plata (tier 1)",
    input: { totalDeposited: 100, totalWithdrawn: 0, position: 100, txCount: 3 },
    expect: { tier: 1, tierName: "Plata", isHistoryEligible: true },
  },
  {
    name: "oro_boundary",
    description: "Moderate saver (400 USDC across 5 deposits, full retention) -> Oro (tier 2)",
    input: { totalDeposited: 400, totalWithdrawn: 0, position: 400, txCount: 5 },
    expect: { tier: 2, tierName: "Oro", isHistoryEligible: true },
  },
  {
    name: "diamante_boundary",
    description: "Strong saver (2,500 USDC across 9 deposits, full retention) -> Diamante (tier 3)",
    input: { totalDeposited: 2500, totalWithdrawn: 0, position: 2500, txCount: 9 },
    expect: { tier: 3, tierName: "Diamante", isHistoryEligible: true },
  },
  {
    name: "platino_boundary",
    description: "Power saver (6,400 USDC across 15 deposits, full retention) -> Platino (tier 4)",
    input: { totalDeposited: 6400, totalWithdrawn: 0, position: 6400, txCount: 15 },
    expect: { tier: 4, tierName: "Platino", isHistoryEligible: true },
  },
  {
    name: "drain_penalty",
    description: "Position < 10% of deposited — score penalized by 80% -> Bronce",
    input: { totalDeposited: 100, totalWithdrawn: 95, position: 5, txCount: 3 },
    expect: { tier: 0, tierName: "Bronce", isHistoryEligible: true },
  },
  {
    name: "partial_withdrawal",
    description: "Partial withdrawals reduce retention rate and score proportionally",
    input: { totalDeposited: 1000, totalWithdrawn: 500, position: 500, txCount: 6 },
    expect: null,
  },
];

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  ✓ ${message}`);
    passed++;
  }
}

console.log("=== Vyn Financial Reputation — Stress-Test Fixture ===\n");

for (const scenario of SCENARIOS) {
  console.log(`[${scenario.name}] ${scenario.description}`);

  const result = computeFinancialReputation(scenario.input);

  console.log(`  score=${result.score} tier=${result.tier} (${result.tierName})`);
  if (result.metrics) {
    const m = result.metrics;
    console.log(
      `  retention=${m.retention} activity=${m.activity} volumeFactor=${m.volumeFactor} volumeIn=${m.volumeIn} volumeOut=${m.volumeOut}`
    );
  }

  if (scenario.expect) {
    const e = scenario.expect;
    if (e.tier !== undefined) assert(result.tier === e.tier, `tier === ${e.tier}`);
    if (e.tierName !== undefined)
      assert(result.tierName === e.tierName, `tierName === "${e.tierName}"`);
    if (e.isHistoryEligible !== undefined) {
      assert(
        result.eligibility.isHistoryEligible === e.isHistoryEligible,
        `isHistoryEligible === ${e.isHistoryEligible}`
      );
    }
  } else {
    assert(typeof result.score === "number", "result.score is a number");
  }

  console.log();
}

console.log(`=== Results: ${passed} passed, ${failed} failed ===`);

if (failed > 0) {
  process.exit(1);
}
