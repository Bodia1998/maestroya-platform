import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 86 — Stripe Chargeback & Dispute Handling.
 *
 * Raised by `ProcessStripeDisputeWebhookUseCase.handleCreated` the moment
 * a NEW `StripeDispute` row has been durably persisted for a
 * `charge.dispute.created` delivery — never on a duplicate/idempotent
 * replay (mirrors `DisputeCreated`'s (Module 21) own "only on first
 * creation" convention). Carries no financial-outcome information — see
 * this module's own doc comment on why `charge.dispute.created` never
 * itself moves money (the outcome is only known at `charge.dispute.closed`,
 * see `StripeDisputeClosed`).
 *
 * Consumer: `RecordStripeDisputeAuditLogSubscriber` (this module) — the
 * same "audit-log subscriber per financial-observability event"
 * convention `RecordDisputeCreatedAuditLogSubscriber` (Module 21)/
 * `RecordPaymentRefundedAuditLogSubscriber` (Module 77) already
 * establish.
 */
export class StripeDisputeOpened extends DomainEvent {
  static readonly eventName = "stripe_dispute.opened";

  constructor(
    readonly stripeDisputeRecordId: string,
    readonly stripeDisputeId: string,
    readonly paymentId: string | null,
    readonly jobId: string | null,
    readonly amount: number,
    readonly currency: string,
    readonly reason: string | null,
  ) {
    super();
  }
}
