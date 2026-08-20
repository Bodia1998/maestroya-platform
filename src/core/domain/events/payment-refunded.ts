import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 77 — Refund & Dispute Financial Execution.
 *
 * Raised by `ExecuteRefundUseCase` the moment a Stripe Refund has actually
 * been accepted by Stripe and the local `Payment`/`Refund` rows have been
 * durably updated — never before those writes commit, mirroring
 * `ProfessionalPayoutExecuted`'s own "only raised on the transition into
 * the terminal, money-actually-moved state" convention. Raised once per
 * successfully processed `Refund` row; an idempotent replay (the same
 * `financialAdjustmentId` re-executed) never re-publishes this a second
 * time.
 *
 * `newPaymentStatus` is `"REFUNDED"` or `"PARTIALLY_REFUNDED"` — the
 * `Payment` aggregate's own vocabulary (`domain/value-objects/
 * payment-status.ts`), never re-derived by a subscriber.
 *
 * Consumer: `RecordRefundAuditLogSubscriber` (this module) — the same
 * "audit-log subscriber per financial event" convention
 * `RecordDisputeFinancialOutcomeAuditLogSubscriber` (Module 68) already
 * establishes. Future modules (customer notifications, tax credit notes)
 * can subscribe independently without this module knowing they exist —
 * see `EventBus`'s own doc comment on why subscriptions are never
 * centrally enumerated.
 */
export class PaymentRefunded extends DomainEvent {
  static readonly eventName = "payment.refunded";

  constructor(
    readonly refundId: string,
    readonly paymentId: string,
    readonly jobId: string | null,
    readonly financialAdjustmentId: string,
    readonly amount: number,
    readonly currency: string,
    readonly newPaymentStatus: "REFUNDED" | "PARTIALLY_REFUNDED",
    readonly stripeRefundId: string,
  ) {
    super();
  }
}
