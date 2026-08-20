import type { RefundExecutionRequest, RefundExecutor } from "@/application/ports/refund-executor";
import type { FailureReporter } from "@/application/ports/failure-reporter";
import type { ExecuteRefundUseCase } from "@/application/use-cases/refunds/execute-refund.use-case";

/**
 * Module 77 — Refund & Dispute Financial Execution.
 *
 * The one real `RefundExecutor` implementation — a thin adapter from
 * Module 68's `RefundExecutor` port to this module's own
 * `ExecuteRefundUseCase`. Composed in `dispute-resolution/compose.ts` and
 * injected into `ResolveDisputeWithFinancialOutcomeUseCase`, keeping that
 * class's own layering intact (it depends only on the port, never on this
 * class or `ExecuteRefundUseCase` directly).
 *
 * Never rethrows: `RefundExecutor.executeForAdjustment`'s own doc comment
 * documents why — a Stripe/refund-execution failure here must not abort
 * `ResolveDisputeWithFinancialOutcomeUseCase.applyAdjustments`'s loop
 * (which already treats it as "report for manual review, mark the
 * decision PARTIALLY_APPLIED/FAILED," never a hard crash of the whole
 * dispute resolution). This class reports the failure through the same
 * `FailureReporter` that use case already threads through, then swallows
 * it — the `Refund`/`FinancialAdjustment` rows themselves remain the
 * durable, queryable record of what happened for an admin to investigate.
 */
export class DisputeFinancialOutcomeRefundExecutor implements RefundExecutor {
  constructor(
    private readonly executeRefund: ExecuteRefundUseCase,
    private readonly failureReporter: FailureReporter,
  ) {}

  async executeForAdjustment(request: RefundExecutionRequest): Promise<void> {
    try {
      await this.executeRefund.execute({
        financialAdjustmentId: request.financialAdjustmentId,
        paymentId: request.paymentId,
        amount: request.amount,
        requestedByUserId: request.requestedByUserId,
        reason: request.reason,
      });
    } catch (error) {
      this.failureReporter.report(error instanceof Error ? error : new Error(String(error)), {
        financialAdjustmentId: request.financialAdjustmentId,
        disputeId: request.disputeId,
        jobId: request.jobId,
        paymentId: request.paymentId,
        note: "Stripe refund execution failed for a dispute-decided FinancialAdjustment — requires manual admin review.",
      });
    }
  }
}
