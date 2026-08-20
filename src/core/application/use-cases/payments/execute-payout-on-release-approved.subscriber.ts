import { ValidationError } from "@/domain/errors/domain-error";
import type { PaymentReleaseApproved } from "@/domain/events/payment-release-approved";
import type { EventHandler } from "@/application/ports/event-bus";
import type { ExecuteProfessionalPayoutUseCase } from "@/application/use-cases/payments/execute-professional-payout.use-case";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 76 — Professional Payout Execution.
 *
 * The concrete subscriber `PaymentReleaseApproved`'s own doc comment
 * (Module 66, `domain/events/payment-release-approved.ts`) has always
 * named as the expected consumer: "the exact signal a future Stripe
 * Connect payout module... is expected to subscribe to in order to
 * *execute* an already-approved release through \[a\] `PayoutProvider`."
 * Registered from this module's own `compose.ts` (mirrors
 * `RecordCommissionOnPaymentCapturedSubscriber`'s own registration
 * pattern — same file, same "publisher and first subscriber registration
 * live in sibling modules that both depend on financial's already-exported
 * factory" reasoning, applied to `payments/compose.ts` since that is where
 * `ExecuteProfessionalPayoutUseCase` itself is composed).
 *
 * ## A rejected execution is expected, not a bug
 * `ExecuteProfessionalPayoutUseCase.execute` throws `ValidationError` for
 * every precondition it re-checks fresh (payment not yet captured in some
 * unusual ordering, a dispute that reopened between approval and this
 * handler running, a payout hold placed in the interim, ...). None of
 * these are failures of the *subscriber* itself — the use case's own
 * idempotency and "safe to retry" design means a later re-evaluation
 * (another `PaymentReleaseApproved`-triggering event, an admin retry, a
 * reconciliation sweep) will simply try again. This subscriber logs such
 * a `ValidationError` at `info` (mirroring
 * `RecordCommissionOnPaymentCapturedSubscriber`'s own "deferred, not
 * failed" convention) rather than rethrowing it into
 * `EventDispatchError`/Sentry noise. A genuine failure — a Stripe error,
 * an infrastructure error, anything else — is always rethrown, exactly
 * like that sibling subscriber.
 */
export class ExecutePayoutOnReleaseApprovedSubscriber implements EventHandler<PaymentReleaseApproved> {
  constructor(private readonly executePayout: ExecuteProfessionalPayoutUseCase) {}

  async handle(event: PaymentReleaseApproved): Promise<void> {
    try {
      await this.executePayout.execute(event.jobId);
    } catch (error) {
      if (error instanceof ValidationError) {
        logger.info("payment_release_approved.payout_execution_deferred", {
          jobId: event.jobId,
          reason: error.message,
        });
        return;
      }
      throw error;
    }
  }
}
