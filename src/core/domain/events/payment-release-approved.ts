import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 66 — Job Completion & Payment Release Protection.
 *
 * Raised by `EvaluatePaymentReleaseUseCase` when a re-evaluation lands on
 * `RELEASE_APPROVED`. This is the exact signal a future Stripe Connect
 * payout module (Module 67+) is expected to subscribe to in order to
 * *execute* an already-approved release through `PayoutProvider` — this
 * module deliberately does not call any payout/Stripe code itself (see
 * this module's own scope boundary in docs/MODULE_66_...md). Only raised
 * on the transition INTO `RELEASE_APPROVED` (see the use case's own
 * idempotency guard) — re-evaluating an already-approved decision does
 * not raise this a second time.
 */
export class PaymentReleaseApproved extends DomainEvent {
  static readonly eventName = "job.payment-release-approved";

  constructor(
    readonly jobId: string,
    readonly confirmationId: string,
    readonly paymentId: string | null,
  ) {
    super();
  }
}
