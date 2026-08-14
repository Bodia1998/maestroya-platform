import { describe, expect, it } from "vitest";

import { decideAutomatedAction, requiresPayoutHold } from "@/domain/services/trust-integrity-action-policy";
import { RISK_SCORE_THRESHOLDS } from "@/domain/services/risk-score-policy";

describe("Module 65 — decideAutomatedAction", () => {
  it("takes no action below the WARNING threshold", () => {
    const decision = decideAutomatedAction(RISK_SCORE_THRESHOLDS.WARNING - 1, 0);
    expect(decision.tier).toBe("NONE");
    expect(decision.action).toBeNull();
  });

  it("issues a WARNING for a first offense at the WARNING tier", () => {
    const decision = decideAutomatedAction(RISK_SCORE_THRESHOLDS.WARNING, 0);
    expect(decision.action).toBe("WARNING");
    expect(decision.isRepeatOffense).toBe(false);
  });

  it("escalates a repeat offense at the WARNING tier to TEMPORARY_RESTRICTION", () => {
    const decision = decideAutomatedAction(RISK_SCORE_THRESHOLDS.WARNING, 1);
    expect(decision.action).toBe("TEMPORARY_RESTRICTION");
    expect(decision.isRepeatOffense).toBe(true);
  });

  it("issues TEMPORARY_SUSPENSION for a first offense at the SUSPENSION tier", () => {
    const decision = decideAutomatedAction(RISK_SCORE_THRESHOLDS.SUSPENSION, 0);
    expect(decision.action).toBe("TEMPORARY_SUSPENSION");
  });

  it("escalates a repeat offense at the SUSPENSION tier to PERMANENT_SUSPENSION", () => {
    const decision = decideAutomatedAction(RISK_SCORE_THRESHOLDS.SUSPENSION, 1);
    expect(decision.action).toBe("PERMANENT_SUSPENSION");
  });

  it("accepts a custom config override", () => {
    const decision = decideAutomatedAction(RISK_SCORE_THRESHOLDS.WARNING, 0, {
      firstOffense: { WARNING: "TEMPORARY_RESTRICTION", RESTRICTION: "MANUAL_REVIEW", MANUAL_REVIEW: "TEMPORARY_SUSPENSION", SUSPENSION: "PERMANENT_SUSPENSION" },
      repeatOffense: { WARNING: "PERMANENT_SUSPENSION", RESTRICTION: "PERMANENT_SUSPENSION", MANUAL_REVIEW: "PERMANENT_SUSPENSION", SUSPENSION: "PERMANENT_SUSPENSION" },
    });
    expect(decision.action).toBe("TEMPORARY_RESTRICTION");
  });
});

describe("Module 65 — requiresPayoutHold", () => {
  it("is true only for PAYMENT_ABUSE_DETECTED", () => {
    expect(requiresPayoutHold("PAYMENT_ABUSE_DETECTED")).toBe(true);
    expect(requiresPayoutHold("FRAUD_SIGNAL_DETECTED")).toBe(false);
  });
});
