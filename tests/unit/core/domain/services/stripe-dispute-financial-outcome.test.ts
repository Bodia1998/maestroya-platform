import { describe, expect, it } from "vitest";

import { decideStripeDisputeFinancialOutcome } from "@/domain/services/stripe-dispute-financial-outcome";

describe("decideStripeDisputeFinancialOutcome (Module 86)", () => {
  it("WON — no financial action", () => {
    const decision = decideStripeDisputeFinancialOutcome({
      finalStatus: "WON",
      disputeAmount: 1200,
      paymentAmount: 1200,
      alreadyRefunded: 0,
    });
    expect(decision.outcome).toBe("NO_FINANCIAL_ACTION");
    expect(decision.adjustments).toHaveLength(0);
  });

  it("WARNING_CLOSED — no financial action", () => {
    const decision = decideStripeDisputeFinancialOutcome({
      finalStatus: "WARNING_CLOSED",
      disputeAmount: 1200,
      paymentAmount: 1200,
      alreadyRefunded: 0,
    });
    expect(decision.outcome).toBe("NO_FINANCIAL_ACTION");
    expect(decision.adjustments).toHaveLength(0);
  });

  it("LOST, full disputed amount equal to captured amount — FULL_REFUND", () => {
    const decision = decideStripeDisputeFinancialOutcome({
      finalStatus: "LOST",
      disputeAmount: 1200,
      paymentAmount: 1200,
      alreadyRefunded: 0,
    });
    expect(decision.outcome).toBe("CHARGEBACK_LOSS");
    expect(decision.adjustments).toEqual([{ type: "FULL_REFUND", amount: 1200 }]);
  });

  it("LOST, disputed amount smaller than captured amount — PARTIAL_REFUND", () => {
    const decision = decideStripeDisputeFinancialOutcome({
      finalStatus: "LOST",
      disputeAmount: 400,
      paymentAmount: 1200,
      alreadyRefunded: 0,
    });
    expect(decision.outcome).toBe("CHARGEBACK_LOSS");
    expect(decision.adjustments).toEqual([{ type: "PARTIAL_REFUND", amount: 400 }]);
  });

  it("LOST, but the Payment was already fully refunded by another path — no financial action (never double-refunds)", () => {
    const decision = decideStripeDisputeFinancialOutcome({
      finalStatus: "LOST",
      disputeAmount: 1200,
      paymentAmount: 1200,
      alreadyRefunded: 1200,
    });
    expect(decision.outcome).toBe("NO_FINANCIAL_ACTION");
    expect(decision.adjustments).toHaveLength(0);
  });

  it("LOST, a prior partial refund already reduced the remaining captured balance — clamps to what remains", () => {
    const decision = decideStripeDisputeFinancialOutcome({
      finalStatus: "LOST",
      disputeAmount: 1200,
      paymentAmount: 1200,
      alreadyRefunded: 1000,
    });
    expect(decision.outcome).toBe("CHARGEBACK_LOSS");
    expect(decision.adjustments).toEqual([{ type: "FULL_REFUND", amount: 200 }]);
  });

  it("LOST with no matched Payment — no financial action (nothing to adjust)", () => {
    const decision = decideStripeDisputeFinancialOutcome({
      finalStatus: "LOST",
      disputeAmount: 1200,
      paymentAmount: null,
      alreadyRefunded: 0,
    });
    expect(decision.outcome).toBe("NO_FINANCIAL_ACTION");
    expect(decision.adjustments).toHaveLength(0);
  });
});
