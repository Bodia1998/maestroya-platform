import { describe, expect, it } from "vitest";

import { recalculateTrustScore, TRUST_SCORE_DELTA_TABLE, DEFAULT_TRUST_SCORE } from "@/domain/services/trust-score-policy";

describe("Module 65 — recalculateTrustScore", () => {
  it("applies the default delta for a known reason", () => {
    const result = recalculateTrustScore(DEFAULT_TRUST_SCORE, "ACCOUNT_VERIFIED");
    expect(result.scoreBefore).toBe(DEFAULT_TRUST_SCORE);
    expect(result.delta).toBe(TRUST_SCORE_DELTA_TABLE.ACCOUNT_VERIFIED);
    expect(result.scoreAfter).toBe(DEFAULT_TRUST_SCORE + TRUST_SCORE_DELTA_TABLE.ACCOUNT_VERIFIED);
  });

  it("clamps at 100", () => {
    const result = recalculateTrustScore(99, "ACCOUNT_VERIFIED");
    expect(result.scoreAfter).toBe(100);
    expect(result.delta).toBe(1);
  });

  it("clamps at 0", () => {
    const result = recalculateTrustScore(5, "MANUAL_REVIEW_CONFIRMED");
    expect(result.scoreAfter).toBe(0);
  });

  it("uses an override delta for ADMIN_ADJUSTMENT", () => {
    const result = recalculateTrustScore(50, "ADMIN_ADJUSTMENT", -10);
    expect(result.scoreAfter).toBe(40);
  });

  it("reports zero delta when already clamped at the boundary", () => {
    const result = recalculateTrustScore(100, "ACCOUNT_VERIFIED");
    expect(result.scoreAfter).toBe(100);
    expect(result.delta).toBe(0);
  });

  it("every declared reason produces a finite integer delta", () => {
    for (const reason of Object.keys(TRUST_SCORE_DELTA_TABLE) as (keyof typeof TRUST_SCORE_DELTA_TABLE)[]) {
      const result = recalculateTrustScore(50, reason);
      expect(Number.isInteger(result.scoreAfter)).toBe(true);
      expect(result.scoreAfter).toBeGreaterThanOrEqual(0);
      expect(result.scoreAfter).toBeLessThanOrEqual(100);
    }
  });
});
