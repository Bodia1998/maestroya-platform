import { describe, expect, it, vi } from "vitest";

import { DisputeFinancialOutcomeRefundExecutor } from "@/application/use-cases/refunds/dispute-financial-outcome-refund-executor";
import type { ExecuteRefundUseCase } from "@/application/use-cases/refunds/execute-refund.use-case";
import type { FailureReporter } from "@/application/ports/failure-reporter";

describe("DisputeFinancialOutcomeRefundExecutor (Module 77)", () => {
  it("delegates to ExecuteRefundUseCase with the mapped fields", async () => {
    const execute = vi.fn().mockResolvedValue({ id: "refund-1" });
    const executeRefund = { execute } as unknown as ExecuteRefundUseCase;
    const failureReporter: FailureReporter = { report: vi.fn() };

    const executor = new DisputeFinancialOutcomeRefundExecutor(executeRefund, failureReporter);
    await executor.executeForAdjustment({
      financialAdjustmentId: "adj-1",
      paymentId: "payment-1",
      jobId: "job-1",
      disputeId: "dispute-1",
      amount: 50,
      requestedByUserId: "admin-1",
      reason: "Customer favor",
    });

    expect(execute).toHaveBeenCalledWith({
      financialAdjustmentId: "adj-1",
      paymentId: "payment-1",
      amount: 50,
      requestedByUserId: "admin-1",
      reason: "Customer favor",
    });
    expect(failureReporter.report).not.toHaveBeenCalled();
  });

  it("never rethrows — reports the failure so dispute resolution is never aborted by a Stripe failure", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("Stripe is down"));
    const executeRefund = { execute } as unknown as ExecuteRefundUseCase;
    const failureReporter: FailureReporter = { report: vi.fn() };

    const executor = new DisputeFinancialOutcomeRefundExecutor(executeRefund, failureReporter);
    await expect(
      executor.executeForAdjustment({
        financialAdjustmentId: "adj-1",
        paymentId: "payment-1",
        jobId: "job-1",
        disputeId: null,
        amount: 50,
        requestedByUserId: "admin-1",
        reason: null,
      }),
    ).resolves.toBeUndefined();

    expect(failureReporter.report).toHaveBeenCalledTimes(1);
  });
});
