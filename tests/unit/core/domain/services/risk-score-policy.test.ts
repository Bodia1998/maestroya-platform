import { describe, expect, it } from "vitest";

import {
  recalculateRiskScore,
  deriveEscalationTier,
  isAppealable,
  RISK_SCORE_THRESHOLDS,
  RISK_SCORE_DELTA_TABLE,
} from "@/domain/services/risk-score-policy";

describe("Module 65 — recalculateRiskScore", () => {
  it("applies the default delta and clamps within [0, 100]", () => {
    const result = recalculateRiskScore(0, "FRAUD_SIGNAL_DETECTED");
    expect(result.scoreAfter).toBe(RISK_SCORE_DELTA_TABLE.FRAUD_SIGNAL_DETECTED);
  });

  it("never drops below zero", () => {
    const result = recalculateRiskScore(5, "APPEAL_APPROVED");
    expect(result.scoreAfter).toBe(0);
  });

  it("never exceeds 100", () => {
    const result = recalculateRiskScore(95, "MANUAL_REVIEW_CONFIRMED");
    expect(result.scoreAfter).toBe(100);
  });
});

describe("Module 65 — deriveEscalationTier", () => {
  it("is NONE below the WARNING threshold", () => {
    expect(deriveEscalationTier(RISK_SCORE_THRESHOLDS.WARNING - 1)).toBe("NONE");
  });

  it("is WARNING at the WARNING threshold", () => {
    expect(deriveEscalationTier(RISK_SCORE_THRESHOLDS.WARNING)).toBe("WARNING");
  });

  it("is RESTRICTION at the RESTRICTION threshold", () => {
    expect(deriveEscalationTier(RISK_SCORE_THRESHOLDS.RESTRICTION)).toBe("RESTRICTION");
  });

  it("is MANUAL_REVIEW at the MANUAL_REVIEW threshold", () => {
    expect(deriveEscalationTier(RISK_SCORE_THRESHOLDS.MANUAL_REVIEW)).toBe("MANUAL_REVIEW");
  });

  it("is SUSPENSION at and above the SUSPENSION threshold", () => {
    expect(deriveEscalationTier(RISK_SCORE_THRESHOLDS.SUSPENSION)).toBe("SUSPENSION");
    expect(deriveEscalationTier(100)).toBe("SUSPENSION");
  });
});

describe("Module 65 — isAppealable", () => {
  it("is false for NONE and WARNING", () => {
    expect(isAppealable("NONE")).toBe(false);
    expect(isAppealable("WARNING")).toBe(false);
  });

  it("is true for RESTRICTION, MANUAL_REVIEW, and SUSPENSION", () => {
    expect(isAppealable("RESTRICTION")).toBe(true);
    expect(isAppealable("MANUAL_REVIEW")).toBe(true);
    expect(isAppealable("SUSPENSION")).toBe(true);
  });
});
