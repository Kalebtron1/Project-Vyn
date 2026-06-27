/**
 * Regression tests for the scoring algorithm.
 *
 * The score is now computed from the staking_pool's ON-CHAIN aggregates
 * (get_total_deposited / get_total_withdrawn / get_position / get_tx_count),
 * not from Horizon effects. The previous implementation classified a deposit
 * (which DEBITS the user's account) as a "withdrawal", so the score never rose
 * on deposit. These tests pin the new aggregate-based behavior.
 *
 * computeFinancialReputation now takes a single object:
 *   { totalDeposited, totalWithdrawn, position, txCount }
 *
 * How to reproduce manually:
 *   POST /api/calculate-score with { address } — the endpoint reads the same
 *   aggregates on-chain and returns the `score` asserted below.
 */

import { describe, it, expect } from "vitest";
import { computeFinancialReputation } from "../../api/calculate-score.js";

describe("computeFinancialReputation", () => {
  // --- eligibility gate (txCount-based) ---
  it("returns score 0 when tx count is below minimum", () => {
    const result = computeFinancialReputation({
      totalDeposited: 1000,
      totalWithdrawn: 0,
      position: 1000,
      txCount: 2, // < MIN_TX_REQUIRED (3)
    });
    expect(result.score).toBe(0);
    expect(result.tier).toBe(0);
    expect(result.eligibility.isHistoryEligible).toBe(false);
    expect(result.eligibility.remainingForUnlock).toBe(1);
  });

  // --- the core bug: score must RISE as deposits/activity accrue ---
  it("score rises with more activity at full retention", () => {
    const few = computeFinancialReputation({
      totalDeposited: 300, totalWithdrawn: 0, position: 300, txCount: 3,
    });
    const many = computeFinancialReputation({
      totalDeposited: 1000, totalWithdrawn: 0, position: 1000, txCount: 12,
    });
    expect(few.score).toBeGreaterThan(0);
    expect(many.score).toBeGreaterThan(few.score);
  });

  // --- retentionRate cap ---
  it("retentionRate is capped at 1 when position exceeds totalDeposited (yield)", () => {
    const result = computeFinancialReputation({
      totalDeposited: 10_000, totalWithdrawn: 0, position: 15_000, txCount: 5,
    });
    expect(result.metrics.retention).toBeLessThanOrEqual(1);
  });

  it("score with position > deposited equals score with position == deposited", () => {
    const atPar = computeFinancialReputation({
      totalDeposited: 10_000, totalWithdrawn: 0, position: 10_000, txCount: 5,
    });
    const above = computeFinancialReputation({
      totalDeposited: 10_000, totalWithdrawn: 0, position: 20_000, txCount: 5,
    });
    expect(above.score).toBe(atPar.score);
  });

  // --- drain penalty ---
  it("drain penalty: a drained position scores far lower than a healthy one", () => {
    const healthy = computeFinancialReputation({
      totalDeposited: 10_000, totalWithdrawn: 0, position: 10_000, txCount: 6,
    });
    const drained = computeFinancialReputation({
      totalDeposited: 10_000, totalWithdrawn: 9_700, position: 300, txCount: 6,
    }); // position < 10 % of deposited
    expect(drained.score).toBeLessThan(healthy.score);
    expect(drained.score).toBeLessThan(healthy.score * 0.05);
  });

  // --- score ceiling ---
  it("score never exceeds 1000 regardless of inputs", () => {
    const result = computeFinancialReputation({
      totalDeposited: 1_000_000,
      totalWithdrawn: 0,
      position: 1_000_000,
      txCount: 100_000_000_000, // absurd activity → would overflow the cap
    });
    expect(result.score).toBeLessThanOrEqual(1000);
    expect(result.tier).toBeLessThanOrEqual(4);
  });

  // --- tier mapping sanity ---
  it("tier thresholds map correctly (3 deposits, full retention → Plata)", () => {
    // retention = 1, activityFactor = log10(4) ≈ 0.602 → score ≈ 60 → Plata
    const result = computeFinancialReputation({
      totalDeposited: 3_000, totalWithdrawn: 0, position: 3_000, txCount: 3,
    });
    expect(result.tier).toBe(1);
    expect(result.tierName).toBe("Plata");
  });
});
