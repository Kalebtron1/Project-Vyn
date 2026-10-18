/**
 * Regression tests for the scoring algorithm.
 *
 * The score is computed from the staking_pool's ON-CHAIN aggregates
 * (get_total_deposited / get_total_withdrawn / get_position / get_tx_count).
 *
 * Formula:
 *   volumeFactor   = min(1 + sqrt(totalDeposited / 100), 10)
 *   retentionRate  = min(position / totalDeposited, 1)
 *   activityFactor = log10(txCount + 1)
 *   score          = min(volumeFactor * retentionRate * activityFactor * 100, 1000)
 *   drain penalty  = score * 0.2 when position < 10% of totalDeposited
 */

import { describe, it, expect } from "vitest";
import { computeFinancialReputation } from "../../api/calculate-score.js";

describe("computeFinancialReputation", () => {
  it("returns score 0 (Bronce) when tx count is below minimum", () => {
    const result = computeFinancialReputation({
      totalDeposited: 1000,
      totalWithdrawn: 0,
      position: 1000,
      txCount: 2,
    });
    expect(result.score).toBe(0);
    expect(result.tier).toBe(0);
    expect(result.tierName).toBe("Bronce");
    expect(result.eligibility.isHistoryEligible).toBe(false);
    expect(result.eligibility.remainingForUnlock).toBe(1);
  });

  it("score rises with both activity and deposit volume at full retention", () => {
    const lowVol = computeFinancialReputation({
      totalDeposited: 100,
      totalWithdrawn: 0,
      position: 100,
      txCount: 3,
    });
    const highVol = computeFinancialReputation({
      totalDeposited: 900,
      totalWithdrawn: 0,
      position: 900,
      txCount: 3,
    });
    const moreActivity = computeFinancialReputation({
      totalDeposited: 900,
      totalWithdrawn: 0,
      position: 900,
      txCount: 10,
    });
    expect(lowVol.score).toBeGreaterThan(0);
    expect(highVol.score).toBeGreaterThan(lowVol.score);
    expect(moreActivity.score).toBeGreaterThan(highVol.score);
  });

  it("retentionRate is capped at 1 when position exceeds totalDeposited (yield)", () => {
    const result = computeFinancialReputation({
      totalDeposited: 1_000,
      totalWithdrawn: 0,
      position: 1_500,
      txCount: 5,
    });
    expect(result.metrics.retention).toBeLessThanOrEqual(1);
  });

  it("score with position > deposited equals score with position == deposited", () => {
    const atPar = computeFinancialReputation({
      totalDeposited: 1_000,
      totalWithdrawn: 0,
      position: 1_000,
      txCount: 5,
    });
    const above = computeFinancialReputation({
      totalDeposited: 1_000,
      totalWithdrawn: 0,
      position: 2_000,
      txCount: 5,
    });
    expect(above.score).toBe(atPar.score);
  });

  it("drain penalty: a drained position scores far lower than a healthy one", () => {
    const healthy = computeFinancialReputation({
      totalDeposited: 1_000,
      totalWithdrawn: 0,
      position: 1_000,
      txCount: 6,
    });
    const drained = computeFinancialReputation({
      totalDeposited: 1_000,
      totalWithdrawn: 970,
      position: 30,
      txCount: 6,
    });
    expect(drained.score).toBeLessThan(healthy.score);
    expect(drained.score).toBeLessThan(healthy.score * 0.05);
  });

  it("score never exceeds 1000 regardless of inputs", () => {
    const result = computeFinancialReputation({
      totalDeposited: 1_000_000,
      totalWithdrawn: 0,
      position: 1_000_000,
      txCount: 100_000_000_000,
    });
    expect(result.score).toBeLessThanOrEqual(1000);
    expect(result.tier).toBe(4);
  });

  it("reaches Plata (tier 1, 50 <= score < 150) with realistic initial savings", () => {
    const result = computeFinancialReputation({
      totalDeposited: 100,
      totalWithdrawn: 0,
      position: 100,
      txCount: 3,
    });
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.score).toBeLessThan(150);
    expect(result.tier).toBe(1);
    expect(result.tierName).toBe("Plata");
  });

  it("reaches Oro (tier 2, 150 <= score < 500) with moderate savings and activity", () => {
    const result = computeFinancialReputation({
      totalDeposited: 400,
      totalWithdrawn: 0,
      position: 400,
      txCount: 5,
    });
    expect(result.score).toBeGreaterThanOrEqual(150);
    expect(result.score).toBeLessThan(500);
    expect(result.tier).toBe(2);
    expect(result.tierName).toBe("Oro");
  });

  it("reaches Diamante (tier 3, 500 <= score < 1000) with strong savings and activity", () => {
    const result = computeFinancialReputation({
      totalDeposited: 2_500,
      totalWithdrawn: 0,
      position: 2_500,
      txCount: 9,
    });
    expect(result.score).toBeGreaterThanOrEqual(500);
    expect(result.score).toBeLessThan(1000);
    expect(result.tier).toBe(3);
    expect(result.tierName).toBe("Diamante");
  });

  it("reaches Platino (tier 4, score == 1000) with high savings and consistent activity", () => {
    const result = computeFinancialReputation({
      totalDeposited: 6_400,
      totalWithdrawn: 0,
      position: 6_400,
      txCount: 15,
    });
    expect(result.score).toBe(1000);
    expect(result.tier).toBe(4);
    expect(result.tierName).toBe("Platino");
  });
});
