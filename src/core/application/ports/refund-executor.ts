/**
 * Module 77 — Refund & Dispute Financial Execution.
 *
 * The seam `ResolveDisputeWithFinancialOutcomeUseCase` (Module 68) calls
 * through to trigger real Stripe money movement for a refund-type
 * `FinancialAdjustment` it has just created and applied — without Module
 * 68 itself depending on `ExecuteRefundUseCase`, `RefundRepository`,
 * `PaymentGateway`, or anything else Stripe-shaped. Same layering
 * discipline `PaymentGateway`/`StripeTransferGateway` already establish
 * for their own modules: the application layer that *decides* money must
 * move never imports the Stripe SDK or the module that actually moves it.
 *
 * `DisputeFinancialOutcomeRefundExecutor` (`use-cases/refunds/
 * dispute-financial-outcome-refund-executor.ts`) is the one real
 * implementation, composed in `dispute-resolution/compose.ts` once Module
 * 77's own `ExecuteRefundUseCase` exists. `NullRefundExecutor` below is
 * the default `ResolveDisputeWithFinancialOutcomeUseCase`'s constructor
 * already falls back to (mirroring that class's own
 * `failureReporter: FailureReporter = new NullFailureReporter()`
 * convention) so every pre-existing Module 68 test — none of which wire a
 * refund executor — keeps compiling and passing unchanged; production
 * wiring always supplies the real one.
 */
export interface RefundExecutionRequest {
  financialAdjustmentId: string;
  paymentId: string;
  jobId: string;
  disputeId: string | null;
  amount: number;
  requestedByUserId: string;
  reason: string | null;
}

export interface RefundExecutor {
  /**
   * Executes (or safely re-converges on) the real Stripe refund for an
   * already-created, already-`APPLIED` refund-type `FinancialAdjustment`.
   * Deliberately does not return a value or rethrow to its caller as a
   * hard failure — `ResolveDisputeWithFinancialOutcomeUseCase.
   * applyAdjustments` already has its own "never let one adjustment's
   * failure abort the whole resolution, report it for manual review
   * instead" contract (see that method's own doc comment), which this
   * interface's real implementation participates in the same way: a
   * failure is reported via the same `FailureReporter` already threaded
   * through that use case, not thrown past this call.
   */
  executeForAdjustment(request: RefundExecutionRequest): Promise<void>;
}

/** See this file's own doc comment for why a silent no-op default is
 *  safe here specifically (never wired in production — only ever the
 *  constructor default for tests that don't care about Stripe execution)
 *  — unlike `NullPaymentGateway`, which throws loudly because it WAS at
 *  risk of being reached by real production code before Module 59/73
 *  landed. This class can never be reached in production: `dispute-
 *  resolution/compose.ts` always supplies the real executor. */
export class NullRefundExecutor implements RefundExecutor {
  async executeForAdjustment(_request: RefundExecutionRequest): Promise<void> {
    // Intentionally does nothing — see this class's own doc comment.
  }
}
