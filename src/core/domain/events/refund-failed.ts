import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 77 — Refund & Dispute Financial Execution.
 *
 * Raised by `ExecuteRefundUseCase` when a Stripe refund attempt fails
 * (a declined/invalid Stripe request, a transient Stripe-side error, a
 * lost concurrency race that leaves the operation unsafe to retry
 * automatically, ...) — the failure counterpart to `PaymentRefunded`,
 * mirroring `ProfessionalPayoutFailed`'s own role for
 * `ProfessionalPayoutExecuted`. Never raised for a validation error caught
 * *before* any Stripe call was attempted (an already-refunded payment, an
 * amount exceeding what's refundable) — those reject the use case call
 * directly; this event exists only for a failure an admin/reconciliation
 * process needs to be notified about after the fact.
 *
 * Consumer: `RecordRefundAuditLogSubscriber` (this module) — see
 * `PaymentRefunded`'s own doc comment for why an audit-log subscriber is
 * this event's one real consumer today.
 */
export class RefundFailed extends DomainEvent {
  static readonly eventName = "payment.refund-failed";

  constructor(
    readonly refundId: string,
    readonly paymentId: string,
    readonly jobId: string | null,
    readonly financialAdjustmentId: string,
    readonly reason: string,
  ) {
    super();
  }
}
