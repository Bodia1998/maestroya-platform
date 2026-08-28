import { describe, expect, it } from "vitest";

import { checkPaymentConsistency } from "@/domain/services/reconciliation/payment-checks";
import { makeContext, makePayment } from "./fixtures";

describe("checkPaymentConsistency", () => {
  it("reports nothing for a clean, consistent payment", () => {
    expect(checkPaymentConsistency(makeContext())).toEqual([]);
  });

  it("flags a payment amount that does not match the quote total", () => {
    const context = makeContext({ payments: [makePayment({ amount: 950 })] });
    const findings = checkPaymentConsistency(context);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("PAYMENT_AMOUNT_MISMATCH");
    expect(findings[0]?.expectedValue).toBe(1000);
    expect(findings[0]?.actualValue).toBe(950);
  });

  it("flags a currency mismatch between payment and quote", () => {
    const context = makeContext({ payments: [makePayment({ currency: "USD" })] });
    const categories = checkPaymentConsistency(context).map((f) => f.category);
    expect(categories).toContain("PAYMENT_CURRENCY_MISMATCH");
  });

  it("flags a payment whose quoteId does not match the job's quote", () => {
    const context = makeContext({ payments: [makePayment({ quoteId: "quote-other" })] });
    const categories = checkPaymentConsistency(context).map((f) => f.category);
    expect(categories).toContain("PAYMENT_MISSING_JOB_OR_QUOTE");
  });

  it("flags duplicate captured payments for the same job", () => {
    const context = makeContext({
      payments: [makePayment({ id: "payment-1" }), makePayment({ id: "payment-2" })],
    });
    const findings = checkPaymentConsistency(context);
    expect(findings.some((f) => f.category === "DUPLICATE_PAYMENT")).toBe(true);
  });

  it("flags a captured payment with no resolvable job relationship", () => {
    const context = makeContext({ payments: [makePayment({ jobId: null })] });
    const categories = checkPaymentConsistency(context).map((f) => f.category);
    expect(categories).toContain("PAYMENT_SUCCESSFUL_WITHOUT_RELATIONSHIP");
  });

  it("does not flag anything when no payment exists yet", () => {
    expect(checkPaymentConsistency(makeContext({ payments: [] }))).toEqual([]);
  });
});
