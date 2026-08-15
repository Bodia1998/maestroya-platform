import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 66 — Job Completion & Payment Release Protection.
 *
 * Raised by `EvaluatePaymentReleaseUseCase` on every transition INTO
 * `RELEASE_HELD` from a different status (never re-raised on repeated
 * evaluations that land on the same held reason — see that use case's own
 * idempotency guard). Covers the dispute, payout-hold, KYC-pending, and
 * confirmation-timeout paths alike — `reason` (human-readable, mirrors
 * `PaymentReleaseDecision.reason`) is what distinguishes them for anyone
 * subscribing (support tooling, admin dashboards).
 */
export class PaymentReleaseHeld extends DomainEvent {
  static readonly eventName = "job.payment-release-held";

  constructor(
    readonly jobId: string,
    readonly confirmationId: string,
    readonly reason: string,
  ) {
    super();
  }
}
