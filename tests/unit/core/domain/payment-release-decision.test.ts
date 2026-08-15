import { describe, expect, it } from "vitest";

import {
  decidePaymentReleaseStatus,
  type PaymentReleaseDecisionInput,
} from "@/domain/services/payment-release-decision";

const BASE: PaymentReleaseDecisionInput = {
  jobStatus: "COMPLETED",
  confirmationStatus: "CONFIRMED",
  hasBlockingDispute: false,
  paymentStatus: "CAPTURED",
  payoutEligible: true,
  payoutHoldActive: false,
};

describe("payment-release-decision", () => {
  describe("financial safety — no single condition is sufficient alone", () => {
    it("does NOT approve release from job completion alone (payment never captured)", () => {
      const result = decidePaymentReleaseStatus({
        ...BASE,
        confirmationStatus: "CONFIRMED",
        paymentStatus: null,
      });
      expect(result.status).not.toBe("RELEASE_APPROVED");
    });

    it("does NOT approve release from Payment.CAPTURED alone (job not completed / no confirmation)", () => {
      const result = decidePaymentReleaseStatus({
        ...BASE,
        jobStatus: "IN_PROGRESS",
        confirmationStatus: null,
      });
      expect(result.status).toBe("RELEASE_HELD");
    });

    it("does NOT approve release from KYC eligibility alone (customer never confirmed)", () => {
      const result = decidePaymentReleaseStatus({
        ...BASE,
        confirmationStatus: "WAITING_FOR_CUSTOMER",
        payoutEligible: true,
      });
      expect(result.status).toBe("RELEASE_HELD");
    });

    it("approves release only when every condition holds simultaneously", () => {
      const result = decidePaymentReleaseStatus(BASE);
      expect(result.status).toBe("RELEASE_APPROVED");
    });
  });

  describe("customer silence is never treated as confirmation", () => {
    it("holds release while waiting for the customer, never approves", () => {
      const result = decidePaymentReleaseStatus({ ...BASE, confirmationStatus: "WAITING_FOR_CUSTOMER" });
      expect(result.status).toBe("RELEASE_HELD");
    });

    it("holds release (never approves) after a confirmation timeout, even with everything else satisfied", () => {
      const result = decidePaymentReleaseStatus({ ...BASE, confirmationStatus: "TIMED_OUT_UNDER_REVIEW" });
      expect(result.status).toBe("RELEASE_HELD");
    });
  });

  describe("dispute blocks release", () => {
    it("holds release when the confirmation itself is DISPUTED", () => {
      const result = decidePaymentReleaseStatus({ ...BASE, confirmationStatus: "DISPUTED", hasBlockingDispute: true });
      expect(result.status).toBe("RELEASE_HELD");
    });

    it("holds release when any other dispute on the job is still open, even if confirmed", () => {
      const result = decidePaymentReleaseStatus({ ...BASE, confirmationStatus: "CONFIRMED", hasBlockingDispute: true });
      expect(result.status).toBe("RELEASE_HELD");
    });

    it("does not block release once every dispute is closed", () => {
      const result = decidePaymentReleaseStatus({ ...BASE, hasBlockingDispute: false });
      expect(result.status).toBe("RELEASE_APPROVED");
    });
  });

  describe("payout hold blocks release", () => {
    it("holds release when a Trust & Integrity payout hold is active", () => {
      const result = decidePaymentReleaseStatus({ ...BASE, payoutHoldActive: true });
      expect(result.status).toBe("RELEASE_HELD");
    });
  });

  describe("payout (KYC) eligibility", () => {
    it("holds release when the professional is not payout-eligible", () => {
      const result = decidePaymentReleaseStatus({ ...BASE, payoutEligible: false });
      expect(result.status).toBe("RELEASE_HELD");
    });
  });

  describe("permanent denials", () => {
    it("denies release when the job was cancelled, regardless of everything else", () => {
      const result = decidePaymentReleaseStatus({ ...BASE, jobStatus: "CANCELLED" });
      expect(result.status).toBe("RELEASE_DENIED");
    });

    it("denies release when no payment exists", () => {
      const result = decidePaymentReleaseStatus({ ...BASE, paymentStatus: null });
      expect(result.status).toBe("RELEASE_DENIED");
    });

    it.each(["FAILED", "CANCELLED", "REFUNDED"] as const)("denies release when payment status is %s", (status) => {
      const result = decidePaymentReleaseStatus({ ...BASE, paymentStatus: status });
      expect(result.status).toBe("RELEASE_DENIED");
    });
  });

  describe("admin override — DISPUTED/TIMED_OUT_UNDER_REVIEW escape hatch", () => {
    it("without the override, DISPUTED never approves even if the linked dispute is effectively resolved", () => {
      const result = decidePaymentReleaseStatus({ ...BASE, confirmationStatus: "DISPUTED", hasBlockingDispute: false });
      expect(result.status).toBe("RELEASE_HELD");
    });

    it("with the override, DISPUTED can approve once every other condition holds", () => {
      const result = decidePaymentReleaseStatus({
        ...BASE,
        confirmationStatus: "DISPUTED",
        hasBlockingDispute: false,
        adminOverrideConfirmed: true,
      });
      expect(result.status).toBe("RELEASE_APPROVED");
    });

    it("the override never bypasses payout hold or KYC", () => {
      const heldByHold = decidePaymentReleaseStatus({
        ...BASE,
        confirmationStatus: "TIMED_OUT_UNDER_REVIEW",
        adminOverrideConfirmed: true,
        payoutHoldActive: true,
      });
      expect(heldByHold.status).toBe("RELEASE_HELD");

      const heldByKyc = decidePaymentReleaseStatus({
        ...BASE,
        confirmationStatus: "TIMED_OUT_UNDER_REVIEW",
        adminOverrideConfirmed: true,
        payoutEligible: false,
      });
      expect(heldByKyc.status).toBe("RELEASE_HELD");
    });

    it("the override never bypasses a cancelled job or an uncaptured payment", () => {
      const cancelled = decidePaymentReleaseStatus({
        ...BASE,
        jobStatus: "CANCELLED",
        confirmationStatus: "DISPUTED",
        adminOverrideConfirmed: true,
      });
      expect(cancelled.status).toBe("RELEASE_DENIED");
    });
  });
});
