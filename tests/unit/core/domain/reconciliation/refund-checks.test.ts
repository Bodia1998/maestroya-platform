import { describe, expect, it } from "vitest";

import { checkRefundConsistency } from "@/domain/services/reconciliation/refund-checks";
import { makeContext, makePayment, makeRefund } from "./fixtures";

describe("checkRefundConsistency", () => {
  it("reports nothing when there are no refunds", () => {
    expect(checkRefundConsistency(makeContext({ refunds: [] }))).toEqual([]);
  });

  it("reports nothing for a single PROCESSED refund consistent with its payment", () => {
    const context = makeContext({
      payments: [makePayment({ status: "PARTIALLY_REFUNDED" })],
      refunds: [makeRefund({ amount: 200 })],
    });
    expect(checkRefundConsistency(context)).toEqual([]);
  });

  it("flags a refund whose paymentId does not resolve to any gathered Payment", () => {
    const context = makeContext({ refunds: [makeRefund({ paymentId: "payment-nonexistent" })] });
    const findings = checkRefundConsistency(context);
    expect(findings.some((f) => f.category === "REFUND_MISSING_PAYMENT_RELATIONSHIP")).toBe(true);
  });

  it("flags a PROCESSED refund whose payment status is not REFUNDED/PARTIALLY_REFUNDED", () => {
    const context = makeContext({
      payments: [makePayment({ status: "CAPTURED" })],
      refunds: [makeRefund({ status: "PROCESSED" })],
    });
    const findings = checkRefundConsistency(context);
    expect(findings.some((f) => f.category === "REFUND_STATE_INCONSISTENT_WITH_PAYMENT")).toBe(true);
  });

  it("flags a negative refund amount", () => {
    const context = makeContext({
      payments: [makePayment({ status: "PARTIALLY_REFUNDED" })],
      refunds: [makeRefund({ amount: -50 })],
    });
    const findings = checkRefundConsistency(context);
    expect(findings.some((f) => f.category === "REFUND_AMOUNT_OR_CURRENCY_MISMATCH")).toBe(true);
  });

  it("flags total PROCESSED refunds exceeding the captured payment amount", () => {
    const context = makeContext({
      payments: [makePayment({ status: "REFUNDED", amount: 1000 })],
      refunds: [
        makeRefund({ id: "refund-1", amount: 700 }),
        makeRefund({ id: "refund-2", amount: 500 }),
      ],
    });
    const findings = checkRefundConsistency(context);
    expect(findings.some((f) => f.category === "REFUND_EXCEEDS_REFUNDABLE_AMOUNT")).toBe(true);
  });

  it("flags two PROCESSED refunds on the same payment with an identical amount as a possible duplicate", () => {
    const context = makeContext({
      payments: [makePayment({ status: "PARTIALLY_REFUNDED", amount: 1000 })],
      refunds: [
        makeRefund({ id: "refund-1", amount: 200 }),
        makeRefund({ id: "refund-2", amount: 200 }),
      ],
    });
    const findings = checkRefundConsistency(context);
    expect(findings.some((f) => f.category === "DUPLICATE_REFUND")).toBe(true);
  });

  it("does not flag two PROCESSED refunds with different amounts as duplicates", () => {
    const context = makeContext({
      payments: [makePayment({ status: "PARTIALLY_REFUNDED", amount: 1000 })],
      refunds: [
        makeRefund({ id: "refund-1", amount: 200 }),
        makeRefund({ id: "refund-2", amount: 300 }),
      ],
    });
    expect(checkRefundConsistency(context).some((f) => f.category === "DUPLICATE_REFUND")).toBe(false);
  });
});
