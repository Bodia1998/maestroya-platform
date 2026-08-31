import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 86 — Stripe Chargeback & Dispute Handling.
 *
 * Raised by `ProcessStripeDisputeWebhookUseCase.handleClosed` the moment
 * a `StripeDispute` row has been durably moved to its terminal status
 * (`WON`/`LOST`/`WARNING_CLOSED`) — never on an idempotent replay of an
 * already-closed dispute (mirrors `ProfessionalPayoutReversed`'s (Module
 * 77) own "only raised on the transition into the terminal state"
 * convention).
 *
 * `financialAdjustmentId` is non-null only for `outcome === "LOST"` — see
 * this module's own financial-outcome decision function
 * (`decideStripeDisputeFinancialOutcome`) for why `WON`/`WARNING_CLOSED`
 * never create one (Stripe itself already returned the disputed funds to
 * the platform's balance; recording a second, platform-side adjustment
 * for that would double-count a recovery this platform never decided or
 * executed).
 *
 * Consumers: `RecordStripeDisputeAuditLogSubscriber` (this module,
 * observability) and — for a `LOST` outcome against a Job that has a
 * `PROFESSIONAL_SELF_BILLED` Invoice — the credit-note integration this
 * module wires into Module 85's existing `CreateCreditNoteUseCase` (see
 * `create-credit-note-for-lost-stripe-dispute.subscriber.ts`).
 */
export class StripeDisputeClosed extends DomainEvent {
  static readonly eventName = "stripe_dispute.closed";

  constructor(
    readonly stripeDisputeRecordId: string,
    readonly stripeDisputeId: string,
    readonly paymentId: string | null,
    readonly jobId: string | null,
    readonly outcome: "WON" | "LOST" | "WARNING_CLOSED",
    readonly amount: number,
    readonly currency: string,
    readonly financialAdjustmentId: string | null,
  ) {
    super();
  }
}
