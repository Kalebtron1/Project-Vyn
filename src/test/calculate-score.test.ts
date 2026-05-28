/**
 * Regression tests for the scoring algorithm (issue #42).
 *
 * These tests import computeFinancialReputation directly and verify the
 * before/after behavior for the three edge cases that motivated the fix:
 *
 *  1. Spike sensitivity — a single huge recent deposit should not push the
 *     score to an extreme tier when the rest of the history is modest.
 *
 *  2. retentionRate > 1 — a balance that grew beyond total deposits must not
 *     inflate the score above what full retention (rate = 1) would produce.
 *
 *  3. Drain penalty — a balance below 10 % of totalDeposited must cut the
 *     score by 80 % regardless of weighted volume.
 *
 * How to reproduce manually:
 *   POST /api/calculate-score with the body shown in each test comment.
 *   The `score` field in the response should match the assertion.
 */

import { describe, it, expect } from "vitest";
import { computeFinancialReputation } from "../../api/calculate-score.js";

// Helper: build a tx dated N days ago
function tx(amount: number, type: "deposit" | "withdrawal", daysAgo: number) {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return { amount, type, date };
}

describe("computeFinancialReputation", () => {
  // --- eligibility gate ---
  it("returns score 0 when history is below minimum", () => {
    const result = computeFinancialReputation([tx(1000, "deposit", 1)], 1000);
    expect(result.score).toBe(0);
    expect(result.tier).toBe(0);
    expect(result.eligibility.isHistoryEligible).toBe(false);
  });

  // --- spike sensitivity (issue #42 core case) ---
  it("spike: one massive recent deposit + two small old ones stays in a reasonable tier", () => {
    // Before fix: timeWeight = 1/(daysAgo+1) made the 10 000 deposit dominate completely.
    // After fix: 30-day half-life decay + normalization keeps the score proportional.
    const history = [
      tx(10_000, "deposit", 0),  // spike today
      tx(100,    "deposit", 60),
      tx(100,    "deposit", 90),
    ];
    const result = computeFinancialReputation(history, 10_200);
    // normalizedVolume ≈ (10000*1 + 100*(1/3) + 100*(1/4)) / 10200 ≈ 0.985
    // retentionRate = min(10200/10200, 1) = 1
    // activityFactor = log10(4) ≈ 0.602
    // score ≈ 0.985 * 1 * 0.602 * 100 ≈ 59 → Plata
    expect(result.tier).toBeLessThanOrEqual(1); // must not jump to Oro or above
    expect(result.score).toBeGreaterThan(0);
  });

  it("spike: a single spike does not push score above Plata tier with minimal history", () => {
    // Even with a 10 000 XLM deposit today, only 3 txs → activityFactor is low.
    // The score should stay in Plata (50–149), not jump to Oro or above.
    const spike = [
      tx(10_000, "deposit", 0),
      tx(100,    "deposit", 60),
      tx(100,    "deposit", 90),
    ];
    const result = computeFinancialReputation(spike, 10_200);
    expect(result.tier).toBeLessThanOrEqual(1); // Plata or below
  });

  // --- retentionRate cap (issue #42) ---
  it("retentionRate is capped at 1 when balance exceeds totalDeposited", () => {
    // balance 15 000 > totalDeposited 10 000 — old code: retentionRate = 1.5
    const history = [tx(5_000, "deposit", 10), tx(3_000, "deposit", 20), tx(2_000, "deposit", 30)];
    const result = computeFinancialReputation(history, 15_000);
    expect(result.metrics.retention).toBeLessThanOrEqual(1);
  });

  it("score with balance > totalDeposited equals score with balance == totalDeposited", () => {
    const history = [tx(5_000, "deposit", 10), tx(3_000, "deposit", 20), tx(2_000, "deposit", 30)];
    const atPar   = computeFinancialReputation(history, 10_000);
    const above   = computeFinancialReputation(history, 20_000);
    expect(above.score).toBe(atPar.score);
  });

  // --- drain penalty ---
  it("drain penalty: score with drained balance is lower than score with healthy balance", () => {
    const history = [tx(3_000, "deposit", 5), tx(3_000, "deposit", 15), tx(4_000, "deposit", 25)];
    const healthy = computeFinancialReputation(history, 10_000); // full balance
    const drained = computeFinancialReputation(history, 500);    // < 10 % of 10 000
    // Drained score must be strictly lower (penalty + low retentionRate both apply)
    expect(drained.score).toBeLessThan(healthy.score);
    // And the drained score must be very small (< 5 % of healthy)
    expect(drained.score).toBeLessThan(healthy.score * 0.05);
  });

  // --- score ceiling ---
  it("score never exceeds 1000 regardless of inputs", () => {
    // Flood of very recent large deposits
    const history = Array.from({ length: 30 }, (_, i) =>
      tx(1_000_000, "deposit", i)
    );
    const result = computeFinancialReputation(history, 30_000_000);
    expect(result.score).toBeLessThanOrEqual(1000);
    expect(result.tier).toBeLessThanOrEqual(4);
  });

  // --- tier mapping sanity ---
  it("tier thresholds map correctly", () => {
    // We drive score by controlling a minimal, predictable history
    // 3 deposits of equal size, all today → normalizedVolume ≈ 1, retention = 1
    // activityFactor = log10(4) ≈ 0.602 → score ≈ 60 → Plata
    const history = [tx(1_000, "deposit", 0), tx(1_000, "deposit", 0), tx(1_000, "deposit", 0)];
    const result = computeFinancialReputation(history, 3_000);
    expect(result.tier).toBe(1);
    expect(result.tierName).toBe("Plata");
  });
});
