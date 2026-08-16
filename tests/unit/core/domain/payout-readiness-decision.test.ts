import { describe, expect, it } from "vitest";

import { decidePayoutReadiness, type PayoutReadinessInput } from "@/domain/services/payout-readiness-decision";

/**
 * Module 69 — Financial Ledger & Payout Readiness Audit: unit tests for the
 * payout readiness contract (Section 24). Pure function, no I/O — same
 * testing style as payment-release-decision.test.ts.
 */

const BASE: PayoutReadinessInput = {
  releaseStatus: "RELEASE_APPROVED",
  kycEligible: true,
  payoutHoldActive: false,
  financiallyConsistent: true,
  recognizedPayableAmount: 1000,
  amountAlreadyPaidOut: 0,
};

describe("decidePayoutReadiness", () => {
  it("is eligible when every condition holds", () => {
    const decision = decidePayoutReadiness(BASE);
    expect(decision.status).toBe("eligible");
    expect(decision.payableAmount).toBe(1000);
  });

  it("is financial_inconsistency when reconciliation found a problem — and this wins over every other input", () => {
    const decision = decidePayoutReadiness({
      ...BASE,
      financiallyConsistent: false,
      payoutHoldActive: true,
      releaseStatus: "RELEASE_DENIED",
    });
    expect(decision.status).toBe("financial_inconsistency");
    expect(decision.payableAmount).toBe(0);
  });

  it("is denied when release was permanently denied", () => {
    const decision = decidePayoutReadiness({ ...BASE, releaseStatus: "RELEASE_DENIED" });
    expect(decision.status).toBe("denied");
  });

  it("is held when a Trust & Integrity payout hold is active, even if everything else is approved", () => {
    const decision = decidePayoutReadiness({ ...BASE, payoutHoldActive: true });
    expect(decision.status).toBe("held");
    expect(decision.payableAmount).toBe(0);
  });

  it("is held when release is RELEASE_HELD", () => {
    const decision = decidePayoutReadiness({ ...BASE, releaseStatus: "RELEASE_HELD" });
    expect(decision.status).toBe("held");
  });

  it("is pending when no release decision exists yet", () => {
    const decision = decidePayoutReadiness({ ...BASE, releaseStatus: null });
    expect(decision.status).toBe("pending");
  });

  it("is pending when KYC is not yet approved", () => {
    const decision = decidePayoutReadiness({ ...BASE, kycEligible: false });
    expect(decision.status).toBe("pending");
  });

  it("is insufficient_balance when nothing has been recognized yet", () => {
    const decision = decidePayoutReadiness({ ...BASE, recognizedPayableAmount: null });
    expect(decision.status).toBe("insufficient_balance");
    expect(decision.payableAmount).toBe(0);
  });

  it("is insufficient_balance when the recognized amount has already been fully paid out", () => {
    const decision = decidePayoutReadiness({ ...BASE, recognizedPayableAmount: 1000, amountAlreadyPaidOut: 1000 });
    expect(decision.status).toBe("insufficient_balance");
  });

  it("never returns a negative payableAmount", () => {
    const decision = decidePayoutReadiness({ ...BASE, recognizedPayableAmount: 500, amountAlreadyPaidOut: 900 });
    expect(decision.payableAmount).toBe(0);
    expect(decision.status).toBe("insufficient_balance");
  });

  it("subtracts amountAlreadyPaidOut from the payable total when eligible", () => {
    const decision = decidePayoutReadiness({ ...BASE, recognizedPayableAmount: 1000, amountAlreadyPaidOut: 400 });
    expect(decision.status).toBe("eligible");
    expect(decision.payableAmount).toBe(600);
  });
});
