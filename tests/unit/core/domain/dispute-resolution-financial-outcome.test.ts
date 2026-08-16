import { describe, expect, it } from "vitest";

import { ValidationError } from "@/domain/errors/domain-error";
import {
  decideDisputeFinancialOutcome,
  disputeResolutionRequiresFinancialSettlementBeforeClose,
  type DisputeFinancialOutcomeInput,
} from "@/domain/services/dispute-resolution-financial-outcome";

const BASE: DisputeFinancialOutcomeInput = {
  resolution: "NO_ACTION",
  paymentAmount: 200,
  requestedAmount: null,
  requestedAdjustmentType: null,
};

describe("dispute-resolution-financial-outcome", () => {
  describe("NO_ACTION", () => {
    it("produces no financial adjustments", () => {
      const result = decideDisputeFinancialOutcome({ ...BASE, resolution: "NO_ACTION" });
      expect(result.outcome).toBe("NO_FINANCIAL_ACTION");
      expect(result.adjustments).toHaveLength(0);
    });
  });

  describe("PROFESSIONAL_FAVOR", () => {
    it("produces no financial adjustments — the normal release flow applies unchanged", () => {
      const result = decideDisputeFinancialOutcome({ ...BASE, resolution: "PROFESSIONAL_FAVOR" });
      expect(result.outcome).toBe("FULL_RELEASE");
      expect(result.adjustments).toHaveLength(0);
    });
  });

  describe("CUSTOMER_FAVOR", () => {
    it("produces exactly one FULL_REFUND adjustment for the full captured payment amount", () => {
      const result = decideDisputeFinancialOutcome({ ...BASE, resolution: "CUSTOMER_FAVOR", paymentAmount: 350 });
      expect(result.outcome).toBe("FULL_REFUND");
      expect(result.adjustments).toEqual([{ type: "FULL_REFUND", amount: 350 }]);
    });

    it("throws — never silently produces a $0 refund — when no payment exists", () => {
      expect(() => decideDisputeFinancialOutcome({ ...BASE, resolution: "CUSTOMER_FAVOR", paymentAmount: null })).toThrow(
        ValidationError,
      );
    });

    it("throws when the captured payment amount is zero or negative", () => {
      expect(() => decideDisputeFinancialOutcome({ ...BASE, resolution: "CUSTOMER_FAVOR", paymentAmount: 0 })).toThrow(
        ValidationError,
      );
    });
  });

  describe("PARTIAL_RESOLUTION", () => {
    it("produces a PARTIAL_REFUND for exactly the admin-requested amount, never a derived/prorated one", () => {
      const result = decideDisputeFinancialOutcome({
        ...BASE,
        resolution: "PARTIAL_RESOLUTION",
        paymentAmount: 400,
        requestedAmount: 150,
      });
      expect(result.outcome).toBe("PARTIAL_REFUND");
      expect(result.adjustments).toEqual([{ type: "PARTIAL_REFUND", amount: 150 }]);
    });

    it("throws when no requestedAmount is supplied", () => {
      expect(() =>
        decideDisputeFinancialOutcome({ ...BASE, resolution: "PARTIAL_RESOLUTION", paymentAmount: 400, requestedAmount: null }),
      ).toThrow(ValidationError);
    });

    it("throws when requestedAmount is not strictly less than the captured payment amount (use CUSTOMER_FAVOR for a full refund)", () => {
      expect(() =>
        decideDisputeFinancialOutcome({ ...BASE, resolution: "PARTIAL_RESOLUTION", paymentAmount: 400, requestedAmount: 400 }),
      ).toThrow(ValidationError);
      expect(() =>
        decideDisputeFinancialOutcome({ ...BASE, resolution: "PARTIAL_RESOLUTION", paymentAmount: 400, requestedAmount: 500 }),
      ).toThrow(ValidationError);
    });

    it("throws when requestedAmount is zero or negative", () => {
      expect(() =>
        decideDisputeFinancialOutcome({ ...BASE, resolution: "PARTIAL_RESOLUTION", paymentAmount: 400, requestedAmount: -10 }),
      ).toThrow(ValidationError);
    });
  });

  describe("FINANCIAL_ADJUSTMENT_REQUIRED", () => {
    it("requires an explicit adjustment type — never guesses one", () => {
      expect(() =>
        decideDisputeFinancialOutcome({
          ...BASE,
          resolution: "FINANCIAL_ADJUSTMENT_REQUIRED",
          requestedAmount: 50,
          requestedAdjustmentType: null,
        }),
      ).toThrow(ValidationError);
    });

    it("requires an explicit positive amount", () => {
      expect(() =>
        decideDisputeFinancialOutcome({
          ...BASE,
          resolution: "FINANCIAL_ADJUSTMENT_REQUIRED",
          requestedAmount: null,
          requestedAdjustmentType: "COMMISSION_REVERSAL",
        }),
      ).toThrow(ValidationError);
    });

    it("maps FULL_REFUND explicitly to the FULL_REFUND outcome bucket", () => {
      const result = decideDisputeFinancialOutcome({
        ...BASE,
        resolution: "FINANCIAL_ADJUSTMENT_REQUIRED",
        paymentAmount: 300,
        requestedAmount: 300,
        requestedAdjustmentType: "FULL_REFUND",
      });
      expect(result.outcome).toBe("FULL_REFUND");
      expect(result.adjustments).toEqual([{ type: "FULL_REFUND", amount: 300 }]);
    });

    it("maps PROFESSIONAL_PAYOUT_RELEASE to FULL_RELEASE (money already earned, simply no longer held)", () => {
      const result = decideDisputeFinancialOutcome({
        ...BASE,
        resolution: "FINANCIAL_ADJUSTMENT_REQUIRED",
        paymentAmount: 300,
        requestedAmount: 300,
        requestedAdjustmentType: "PROFESSIONAL_PAYOUT_RELEASE",
      });
      expect(result.outcome).toBe("FULL_RELEASE");
    });

    it("rejects a refund-type adjustment whose amount exceeds the captured payment amount", () => {
      expect(() =>
        decideDisputeFinancialOutcome({
          ...BASE,
          resolution: "FINANCIAL_ADJUSTMENT_REQUIRED",
          paymentAmount: 100,
          requestedAmount: 150,
          requestedAdjustmentType: "PARTIAL_REFUND",
        }),
      ).toThrow(ValidationError);
    });

    it("buckets a non-refund, non-release adjustment (e.g. COMMISSION_REVERSAL) as PARTIAL_REFUND for the coarse outcome summary", () => {
      const result = decideDisputeFinancialOutcome({
        ...BASE,
        resolution: "FINANCIAL_ADJUSTMENT_REQUIRED",
        paymentAmount: null,
        requestedAmount: 40,
        requestedAdjustmentType: "COMMISSION_REVERSAL",
      });
      expect(result.outcome).toBe("PARTIAL_REFUND");
      expect(result.adjustments).toEqual([{ type: "COMMISSION_REVERSAL", amount: 40 }]);
    });
  });

  describe("ESCALATED_EXTERNALLY", () => {
    it("holds — no automatic financial action, no adjustments, no payout merely because it was escalated", () => {
      const result = decideDisputeFinancialOutcome({ ...BASE, resolution: "ESCALATED_EXTERNALLY" });
      expect(result.outcome).toBe("HOLD_FOR_REVIEW");
      expect(result.adjustments).toHaveLength(0);
    });
  });

  describe("disputeResolutionRequiresFinancialSettlementBeforeClose", () => {
    it("requires settlement for the three money-moving resolutions", () => {
      expect(disputeResolutionRequiresFinancialSettlementBeforeClose("CUSTOMER_FAVOR")).toBe(true);
      expect(disputeResolutionRequiresFinancialSettlementBeforeClose("PARTIAL_RESOLUTION")).toBe(true);
      expect(disputeResolutionRequiresFinancialSettlementBeforeClose("FINANCIAL_ADJUSTMENT_REQUIRED")).toBe(true);
    });

    it("does not require settlement for NO_ACTION, PROFESSIONAL_FAVOR, ESCALATED_EXTERNALLY, or a null (REJECTED) resolution", () => {
      expect(disputeResolutionRequiresFinancialSettlementBeforeClose("NO_ACTION")).toBe(false);
      expect(disputeResolutionRequiresFinancialSettlementBeforeClose("PROFESSIONAL_FAVOR")).toBe(false);
      expect(disputeResolutionRequiresFinancialSettlementBeforeClose("ESCALATED_EXTERNALLY")).toBe(false);
      expect(disputeResolutionRequiresFinancialSettlementBeforeClose(null)).toBe(false);
    });
  });
});
