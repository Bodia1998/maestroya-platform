import { Payment } from "@/domain/entities/payment";
import { ConflictError, InvalidPaymentTransitionError, NotFoundError, PaymentGatewayError, ValidationError } from "@/domain/errors/domain-error";
import { RETRYABLE_REFUND_STATUSES, type RefundRecord, type RefundRepository } from "@/domain/repositories/refund-repository";
import type { PaymentRepository } from "@/domain/repositories/payment-repository";
import type { PayoutRepository } from "@/domain/repositories/payout-repository";
import type { PaymentGateway } from "@/application/ports/payment-gateway";
import type { DistributedLock } from "@/application/ports/distributed-lock";
import type { EventBus } from "@/application/ports/event-bus";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";
import type { ReverseProfessionalPayoutUseCase } from "@/application/use-cases/refunds/reverse-professional-payout.use-case";
import { PaymentRefunded } from "@/domain/events/payment-refunded";
import { RefundFailed } from "@/domain/events/refund-failed";
import { logger } from "@/infrastructure/observability/logger";

/** Same lock namespace `ExecuteProfessionalPayoutUseCase` already uses
 *  (`payout:execute:<jobId>`) — see this class's own doc comment on "race
 *  condition protection" for why reusing the exact same key, not a
 *  parallel `refund:execute:<jobId>` key, is what actually gives mutual
 *  exclusion between a refund and a payout for the same Job. */
function payoutLockKey(jobId: string): string {
  return `payout:execute:${jobId}`;
}

const LOCK_TTL_MS = 30_000;
const MAX_STATUS_CONVERGENCE_ATTEMPTS = 3;

export interface ExecuteRefundInput {
  /** The `FinancialAdjustment.id` this refund executes — Module 68's
   *  already-decided, already-`APPLIED` financial outcome. This is the
   *  one field this use case's idempotency is keyed on — see
   *  `RefundRepository`'s own doc comment. NEVER a caller-generated id;
   *  always the real, persisted adjustment id. */
  financialAdjustmentId: string;
  paymentId: string;
  /** Server-derived, authoritative refund amount — the exact amount
   *  Module 68's `decideDisputeFinancialOutcome` already decided (never
   *  re-derived, re-guessed, or accepted from client input here — see
   *  this class's own doc comment on "money is never invented twice"). */
  amount: number;
  requestedByUserId: string;
  reason: string | null;
}

/**
 * Module 77 — Refund & Dispute Financial Execution.
 *
 * The ONE place that actually executes a real Stripe refund for an
 * already-decided refund-type `FinancialAdjustment` — the exact gap
 * `StripePaymentGatewayAdapter.refund`'s own doc comment reserves for this
 * module ("Module 77 ... is where a real refund policy, and the actual
 * Stripe call, belongs"). Never re-decides WHETHER a refund is owed or
 * for how much — that is Module 68's `decideDisputeFinancialOutcome`,
 * already computed by the time this use case is called (see
 * `DisputeFinancialOutcomeRefundExecutor`, this use case's one caller).
 *
 * ## Money is never invented twice
 * `input.amount` is trusted as-is from the caller (Module 68's own
 * decision), but this use case still independently re-validates it
 * against the Payment's own authoritative refundable balance via the
 * `Payment` domain aggregate's `refund()` method (`Payment.
 * remainingRefundableAmount`, `Payment.amount - sumProcessedRefunds`) —
 * never trusting that Module 68 already got this right, the same
 * "defense in depth, never a single point of failure" posture
 * `CreateFinancialAdjustmentUseCase`'s own Invariant 8 guard takes.
 *
 * ## Idempotency
 * `RefundRepository.createPending` is an upsert keyed on
 * `financialAdjustmentId`'s database-level unique constraint (mirrors
 * `PayoutRepository.createPending` exactly) — two concurrent executions
 * of the same logical refund decision converge on the same `Refund` row,
 * never two. `PaymentGateway.refund`'s own `idempotencyKey` (the
 * deterministic `refund:<financialAdjustmentId>`) is the second,
 * independent layer: even if this row's own CAS is somehow bypassed, the
 * same key reused across every retried attempt guarantees Stripe itself
 * never creates a second refund for the same logical operation.
 *
 * ## Race condition protection (refund vs. payout)
 * Before touching Stripe or any Payout-related state, this use case
 * acquires the exact same per-Job lock (`payout:execute:<jobId>`)
 * `ExecuteProfessionalPayoutUseCase` already uses — see that class's own
 * doc comment on its three independent concurrency layers. Holding that
 * lock guarantees a payout execution for the same Job cannot be
 * concurrently in flight while this refund (and any resulting payout
 * reversal) runs, and vice versa. If the lock is already held (a payout
 * is currently executing), this call fails fast with `ConflictError`
 * rather than proceeding unsafely — the caller
 * (`ResolveDisputeWithFinancialOutcomeUseCase.applyAdjustments`) already
 * treats a failed adjustment as "report for manual review, never crash
 * the whole resolution," so a transient lock conflict here safely
 * degrades to "retry later," never a lost/duplicated financial operation.
 * See `ExecuteProfessionalPayoutUseCase`'s own fresh
 * `payment.status === "CAPTURED"` check for the other half of this
 * protection: once this use case's own `Payment.updateStatus` compare-
 * and-swap commits a refunded status, any payout attempt (even one that
 * lost the lock race and retries later) re-reads that fresh status and is
 * blocked by Module 76's own existing guard — no new code in that module
 * was needed for this to hold.
 *
 * ## Pre-payout vs. post-payout
 * After the Stripe refund succeeds and the Payment's status is durably
 * updated, this use case re-reads the Job's Payout (if any) — still
 * inside the same lock. A `PAID` Payout means the professional was
 * already paid before this refund executed; `ReverseProfessionalPayoutUseCase`
 * is invoked to reverse it (Case B). No Payout, or one that never reached
 * `PAID`, means nothing further to reverse (Case A) — Module 76's own
 * `payment.status === "CAPTURED"` check permanently blocks that Payout
 * from ever being executed after this refund's `Payment.updateStatus`
 * commits.
 */
export class ExecuteRefundUseCase {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly refunds: RefundRepository,
    private readonly payouts: PayoutRepository,
    private readonly paymentGateway: PaymentGateway,
    private readonly reversePayout: ReverseProfessionalPayoutUseCase,
    private readonly lock: DistributedLock,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(input: ExecuteRefundInput): Promise<RefundRecord> {
    const payment = await this.payments.findById(input.paymentId);
    if (!payment) {
      throw new NotFoundError("Payment", input.paymentId);
    }

    const idempotencyKey = `refund:${input.financialAdjustmentId}`;
    const refundRow = await this.refunds.createPending({
      paymentId: input.paymentId,
      requestedByUserId: input.requestedByUserId,
      amount: input.amount,
      financialAdjustmentId: input.financialAdjustmentId,
      idempotencyKey,
      notes: input.reason,
    });

    // Idempotent replay — a Stripe refund was already completed for this
    // exact decision. Never call Stripe a second time.
    if (refundRow.status === "PROCESSED") {
      return refundRow;
    }
    if (!RETRYABLE_REFUND_STATUSES.includes(refundRow.status)) {
      // REJECTED/APPROVED — reserved for a future manual-approval
      // workflow this module never writes (see `RefundRepository`'s own
      // doc comment); reaching this means a row was mutated outside this
      // use case's own state machine.
      throw new ValidationError(`Refund ${refundRow.id} is in status ${refundRow.status} and cannot be executed.`);
    }

    const run = async (): Promise<RefundRecord> => {
      // Re-read fresh, immediately before touching Stripe — a payout
      // execution or a different refund attempt may have changed the
      // Payment's status while this call waited for the lock.
      const freshPayment = await this.payments.findById(input.paymentId);
      if (!freshPayment) {
        throw new NotFoundError("Payment", input.paymentId);
      }
      if (freshPayment.status !== "CAPTURED" && freshPayment.status !== "PARTIALLY_REFUNDED") {
        throw new ValidationError(
          `Cannot refund a payment in status ${freshPayment.status} — only CAPTURED or PARTIALLY_REFUNDED payments can be refunded.`,
        );
      }
      if (!freshPayment.stripePaymentIntentId) {
        throw new ValidationError(`Payment ${freshPayment.id} has no Stripe PaymentIntent — cannot execute a refund.`);
      }

      const alreadyRefunded = await this.payments.sumProcessedRefunds(freshPayment.id);
      const domainPayment = Payment.reconstitute(
        {
          serviceRequestId: freshPayment.serviceRequestId,
          payerId: freshPayment.payerId,
          amount: freshPayment.amount,
          currency: freshPayment.currency,
          status: freshPayment.status,
          refundedAmount: alreadyRefunded,
          failureReason: freshPayment.failureReason,
          capturedAt: freshPayment.capturedAt,
        },
        freshPayment.id,
      );

      try {
        // The authoritative "never refund more than was captured" check —
        // see this class's own "money is never invented twice" doc
        // comment. Throws ValidationError if `input.amount` exceeds what
        // remains refundable.
        domainPayment.refund(input.amount);
      } catch (error) {
        if (error instanceof InvalidPaymentTransitionError) {
          throw new ValidationError(error.message);
        }
        throw error;
      }

      try {
        const stripeResult = await this.paymentGateway.refund(freshPayment.stripePaymentIntentId, input.amount, {
          idempotencyKey: refundRow.idempotencyKey ?? idempotencyKey,
        });

        const { record: processedRefund } = await this.refunds.markProcessed({
          id: refundRow.id,
          stripeRefundId: stripeResult.externalRefundReference,
          fromStatuses: RETRYABLE_REFUND_STATUSES,
        });

        await this.convergePaymentStatus(freshPayment.id);

        await publishDomainEvent(
          this.eventBus,
          new PaymentRefunded(
            processedRefund.id,
            freshPayment.id,
            freshPayment.jobId,
            input.financialAdjustmentId,
            input.amount,
            freshPayment.currency,
            domainPayment.status as "REFUNDED" | "PARTIALLY_REFUNDED",
            stripeResult.externalRefundReference,
          ),
          this.failureReporter,
        );

        logger.info("refund_execution.processed", {
          refundId: processedRefund.id,
          paymentId: freshPayment.id,
          jobId: freshPayment.jobId,
          amount: input.amount,
        });

        // --- Post-payout reversal (Case B) ---
        if (freshPayment.jobId) {
          const payout = await this.payouts.findByJobId(freshPayment.jobId);
          if (payout && payout.status === "PAID") {
            await this.reversePayout.execute({
              payoutId: payout.id,
              requestedByUserId: input.requestedByUserId,
              reason: input.reason,
            });
          }
        }

        return processedRefund;
      } catch (error) {
        const message =
          error instanceof PaymentGatewayError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Unknown refund execution failure.";

        const { record: failedRefund } = await this.refunds.markFailed({
          id: refundRow.id,
          failureReason: message,
          fromStatuses: RETRYABLE_REFUND_STATUSES,
        });

        logger.error("refund_execution.failed", {
          refundId: refundRow.id,
          paymentId: input.paymentId,
          error: message,
        });

        await publishDomainEvent(
          this.eventBus,
          new RefundFailed(failedRefund.id, input.paymentId, freshPayment.jobId, input.financialAdjustmentId, message),
          this.failureReporter,
        );

        throw error;
      }
    };

    if (payment.jobId) {
      const result = await this.lock.withLock(payoutLockKey(payment.jobId), LOCK_TTL_MS, run);
      if (result === null) {
        throw new ConflictError(
          `A payout execution is already in progress for job "${payment.jobId}" — refund cannot proceed safely right now, retry shortly.`,
        );
      }
      return result;
    }

    return run();
  }

  /**
   * Persists the Payment's post-refund status via the existing compare-
   * and-swap `PaymentRepository.updateStatus` (see that method's own doc
   * comment). Bounded retry against a lost optimistic-concurrency race —
   * the Stripe refund has ALREADY succeeded by the time this runs, so a
   * lost race here must never be surfaced as a refund failure to the
   * caller; it re-reads the Payment's fresh status/refunded total and
   * retries the CAS with the newly-correct target status. If every
   * attempt is lost (an unusually high-contention case), the failure is
   * reported via `FailureReporter` for manual/Module 80 reconciliation —
   * the money movement itself (the `Refund` row, already `PROCESSED`)
   * remains the authoritative record either way.
   */
  private async convergePaymentStatus(paymentId: string): Promise<void> {
    for (let attempt = 0; attempt < MAX_STATUS_CONVERGENCE_ATTEMPTS; attempt++) {
      const current = await this.payments.findById(paymentId);
      if (!current) return;
      if (current.status === "REFUNDED") return; // already fully converged

      const refundedTotal = await this.payments.sumProcessedRefunds(paymentId);
      const target: "REFUNDED" | "PARTIALLY_REFUNDED" = refundedTotal >= current.amount ? "REFUNDED" : "PARTIALLY_REFUNDED";

      const { applied } = await this.payments.updateStatus({
        id: paymentId,
        fromStatuses: [current.status],
        toStatus: target,
      });
      if (applied) return;
    }

    this.failureReporter.report(
      new Error(`Payment ${paymentId} refunded status could not be converged after ${MAX_STATUS_CONVERGENCE_ATTEMPTS} attempts.`),
      { paymentId, note: "Requires manual reconciliation — the Stripe refund itself already succeeded." },
    );
  }
}
