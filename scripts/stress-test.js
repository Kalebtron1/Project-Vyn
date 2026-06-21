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
 * Seed data assumptions:
 *   - Transaction dates are expressed as "N days before the moment the script
 *     runs" so that time-decay weights are stable across runs (a deposit from
 *     0 days ago always has weight 1, from 1 day ago always has weight 0.5,
 *     etc.).  The absolute timestamps change each day, but the relative
 *     distances — and therefore the tier outcomes — are identical on every run.
 *   - Amounts are in XLM (same unit the API uses after Horizon parsing).
 *   - "totalBalance" represents the current on-chain balance passed to the engine.
 *   - Amounts are derived analytically from the scoring formula so the fixture
 *     is self-documenting and reviewable without running it.
 *
 * Scoring formula (from api/calculate-score.js):
 *   score = (weightedVolume × retentionRate × log10(txCount + 1)) / 60
 *   weightedVolume = Σ deposit.amount × (1 / (daysAgo + 1))
 *   retentionRate  = currentBalance / totalDeposited
 *   drain penalty  : if balance < 10 % of deposited → score × 0.2
 *
 * Tier thresholds:
 *   Plata    ≥  50   Oro  ≥ 150   Diamante ≥ 500   Platino ≥ 1000
 *
 * What this covers:
 *   - Tier boundary conditions (Bronce → Plata → Oro → Diamante → Platino)
 *   - Insufficient history guard (< 3 transactions)
 *   - Account-drain penalty (balance < 10 % of deposited)
 *   - Time-decay weighting (older deposits score lower than recent ones)
 *   - Mixed deposit/withdrawal history
 *
 * What this does NOT cover:
 *   - Horizon HTTP fetching (tested via integration / e2e)
 *   - NFT minting (requires Soroban testnet + admin keypair)
 */

import { computeFinancialReputation } from "../api/calculate-score.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a Date that is `n` days before NOW.
 * Using Date.now() keeps the relative time-decay weights stable across runs:
 * daysAgo(0) always has weight 1/(0+1)=1, daysAgo(1) always has weight 0.5, etc.
 */
function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function deposit(amount, daysBack) {
  return { type: "deposit", amount, date: daysAgo(daysBack) };
}

function withdrawal(amount, daysBack) {
  return { type: "withdrawal", amount, date: daysAgo(daysBack) };
}

// ---------------------------------------------------------------------------
// Fixture scenarios
// ---------------------------------------------------------------------------

const SCENARIOS = [
  {
    name: "insufficient_history",
    description: "Only 2 transactions — below the 3-tx minimum",
    history: [deposit(500, 1), deposit(500, 2)],
    totalBalance: 1000,
    expect: { tier: 0, tierName: "Bronce", isHistoryEligible: false },
  },
  {
    name: "plata_boundary",
    description: "Minimal activity that should land at Plata (tier 1, score ≥ 50)",
    // 3 same-day deposits of 1661 XLM each, full retention.
    // score = (3×1661×1 × 1 × log10(4)) / 60 ≈ 50.0
    history: [deposit(1661, 0), deposit(1661, 0), deposit(1661, 0)],
    totalBalance: 4983,
    expect: { tier: 1, tierName: "Plata" },
  },
  {
    name: "oro_boundary",
    description: "Moderate activity landing at Oro (tier 2, score ≥ 150)",
    // 5 same-day deposits of 2314 XLM each, full retention.
    // score = (5×2314×1 × 1 × log10(6)) / 60 ≈ 150.0
    history: Array.from({ length: 5 }, () => deposit(2314, 0)),
    totalBalance: 11570,
    expect: { tier: 2, tierName: "Oro" },
  },
  {
    name: "diamante_boundary",
    description: "High activity landing at Diamante (tier 3, score ≥ 500)",
    // 10 same-day deposits of 2881 XLM each, full retention.
    // score = (10×2881×1 × 1 × log10(11)) / 60 ≈ 500.0
    history: Array.from({ length: 10 }, () => deposit(2881, 0)),
    totalBalance: 28810,
    expect: { tier: 3, tierName: "Diamante" },
  },
  {
    name: "platino_boundary",
    description: "Very high activity landing at Platino (tier 4, score ≥ 1000)",
    // 20 same-day deposits of 2269 XLM each, full retention.
    // score = (20×2269×1 × 1 × log10(21)) / 60 ≈ 1000.0
    history: Array.from({ length: 20 }, () => deposit(2269, 0)),
    totalBalance: 45380,
    expect: { tier: 4, tierName: "Platino" },
  },
  {
    name: "drain_penalty",
    description: "Balance < 10 % of deposited — score should be penalised 80 % vs full retention",
    // Without penalty: 3 deposits of 1661 XLM → Plata.
    // With balance = 400 (< 10 % of 4983) the penalty fires → score × 0.2 → Bronce.
    history: [deposit(1661, 0), deposit(1661, 0), deposit(1661, 0)],
    totalBalance: 400,
    expect: { tier: 0, tierName: "Bronce" },
  },
  {
    name: "time_decay",
    description: "Same amounts but old deposits should score lower than recent ones",
    historyRecent: [deposit(3000, 0), deposit(3000, 1), deposit(3000, 2)],
    historyOld:    [deposit(3000, 365), deposit(3000, 366), deposit(3000, 367)],
    totalBalance: 9000,
    // We only assert that recent > old, not exact values
    expect: null,
  },
  {
    name: "mixed_deposits_withdrawals",
    description: "Withdrawals reduce retention rate and therefore the score",
    history: [
      deposit(5000, 0), deposit(5000, 1), deposit(5000, 2),
      withdrawal(4000, 3), withdrawal(4000, 4),
    ],
    totalBalance: 2000,
    expect: null, // just assert it runs without throwing
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

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

  if (scenario.name === "time_decay") {
    // Special case: compare two runs
    const recent = computeFinancialReputation(scenario.historyRecent, scenario.totalBalance);
    const old    = computeFinancialReputation(scenario.historyOld,    scenario.totalBalance);
    assert(
      recent.score > old.score,
      `recent score (${recent.score}) > old score (${old.score})`
    );
    console.log(`  recent=${recent.score} tier=${recent.tierName} | old=${old.score} tier=${old.tierName}`);
    console.log();
    continue;
  }

  const result = computeFinancialReputation(scenario.history, scenario.totalBalance);

  // Always print the result for human review
  console.log(`  score=${result.score} tier=${result.tier} (${result.tierName})`);
  if (result.metrics) {
    const m = result.metrics;
    console.log(`  retention=${m.retention} activity=${m.activity} volumeIn=${m.volumeIn} volumeOut=${m.volumeOut}`);
  }

  if (scenario.expect) {
    const e = scenario.expect;
    if (e.tier !== undefined)    assert(result.tier === e.tier,         `tier === ${e.tier}`);
    if (e.tierName !== undefined) assert(result.tierName === e.tierName, `tierName === "${e.tierName}"`);
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

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`=== Results: ${passed} passed, ${failed} failed ===`);

if (failed > 0) {
  process.exit(1);
}
