import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 77 — Refund & Dispute Financial Execution.
 *
 * Raised by `ReverseProfessionalPayoutUseCase` when a Stripe transfer
 * reversal attempt fails — the failure counterpart to
 * `ProfessionalPayoutReversed`, mirroring `ProfessionalPayoutFailed`'s own
 * role. This is the exact "the platform does not accidentally end with
 * customer refunded + professional paid + no valid reversal" alarm the
 * module's safety requirement calls for: whoever consumes this event is
 * the signal that a Payout is now in a state requiring manual financial
 * reconciliation (a future Module 80's job to automate; this module only
 * ever raises the signal, never invents its own reconciliation sweep).
 *
 * Consumer: `RecordRefundAuditLogSubscriber` (this module) — persists the
 * failure to the existing admin audit log so it is visible to an admin
 * today, ahead of any future automated reconciliation tooling.
 */
export class PayoutReversalFailed extends DomainEvent {
  static readonly eventName = "payout.reversal-failed";

  constructor(
    readonly payoutId: string,
    readonly jobId: string | null,
    readonly paymentId: string | null,
    readonly reason: string,
  ) {
    super();
  }
}
