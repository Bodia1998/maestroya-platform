import { describe, expect, it } from "vitest";

import { checkPayoutConsistency } from "@/domain/services/reconciliation/payout-checks";
import { makeContext, makePayout } from "./fixtures";

describe("checkPayoutConsistency", () => {
  it("reports nothing when the Payout matches Payment.amount minus Commission.amount", () => {
    expect(checkPayoutConsistency(makeContext())).toEqual([]);
  });

  it("does nothing when there is no Payout to check", () => {
    expect(checkPayoutConsistency(makeContext({ payout: null }))).toEqual([]);
  });

  it("flags a Payout with no Commission establishing eligibility", () => {
    const context = makeContext({ commission: null });
    const findings = checkPayoutConsistency(context);
    expect(findings).toEqual([
      expect.objectContaining({ category: "PAYOUT_MISSING_ELIGIBLE_RELATIONSHIP" }),
    ]);
  });

  it("flags a Payout amount below the expected professional payout", () => {
    const context = makeContext({ payout: makePayout({ amount: 500 }) });
    const findings = checkPayoutConsistency(context);
    expect(findings.some((f) => f.category === "PAYOUT_AMOUNT_MISMATCH")).toBe(true);
  });

  it("flags a Payout amount above the expected professional payout as CRITICAL-worthy", () => {
    const context = makeContext({ payout: makePayout({ amount: 950 }) });
    const findings = checkPayoutConsistency(context);
    expect(findings.some((f) => f.category === "PAYOUT_EXCEEDS_PAYABLE_AMOUNT")).toBe(true);
  });

  it("flags a Payout whose currency does not match the source Payment", () => {
    const context = makeContext({ payout: makePayout({ currency: "USD" }) });
    const findings = checkPayoutConsistency(context);
    expect(findings.some((f) => f.category === "PAYOUT_CURRENCY_MISMATCH")).toBe(true);
  });

  it("flags a Payout whose paymentId does not correspond to any Payment on the job", () => {
    const context = makeContext({ payout: makePayout({ paymentId: "payment-nonexistent" }) });
    const findings = checkPayoutConsistency(context);
    expect(findings.some((f) => f.category === "DUPLICATE_PAYOUT")).toBe(true);
  });

  it("flags a PAID Payout with no stripeTransferId", () => {
    const context = makeContext({ payout: makePayout({ status: "PAID", stripeTransferId: null }) });
    const findings = checkPayoutConsistency(context);
    expect(findings.some((f) => f.category === "PAYOUT_PROVIDER_REFERENCE_MISMATCH")).toBe(true);
  });

  it("does not flag a non-PAID Payout for a missing stripeTransferId", () => {
    const context = makeContext({ payout: makePayout({ status: "PENDING", stripeTransferId: null }) });
    expect(checkPayoutConsistency(context).some((f) => f.category === "PAYOUT_PROVIDER_REFERENCE_MISMATCH")).toBe(false);
  });
});
