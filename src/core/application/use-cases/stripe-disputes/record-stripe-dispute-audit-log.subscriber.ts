import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { EventHandler } from "@/application/ports/event-bus";
import type { StripeDisputeOpened } from "@/domain/events/stripe-dispute-opened";
import type { StripeDisputeClosed } from "@/domain/events/stripe-dispute-closed";

/**
 * Module 86 — Stripe Chargeback & Dispute Handling: audit-log subscribers
 * for this module's two events, mirroring
 * `RecordPaymentRefundedAuditLogSubscriber` (Module 77) exactly —
 * translates each event into the existing `AdminAuditLogRepository.record`
 * call, no business logic. `adminUserId: null` — both events are raised
 * by Stripe's own dispute resolution, never a direct admin action, the
 * same "system-triggered entry with no human actor" case that subscriber
 * already documents.
 */
export class RecordStripeDisputeOpenedAuditLogSubscriber implements EventHandler<StripeDisputeOpened> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: StripeDisputeOpened): Promise<void> {
    await this.auditLog.record({
      adminUserId: null,
      action: "STRIPE_DISPUTE_OPENED",
      targetType: "StripeDispute",
      targetId: event.stripeDisputeRecordId,
      metadata: {
        stripeDisputeId: event.stripeDisputeId,
        paymentId: event.paymentId,
        jobId: event.jobId,
        amount: event.amount,
        currency: event.currency,
        reason: event.reason,
      },
    });
  }
}

export class RecordStripeDisputeClosedAuditLogSubscriber implements EventHandler<StripeDisputeClosed> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: StripeDisputeClosed): Promise<void> {
    await this.auditLog.record({
      adminUserId: null,
      action: "STRIPE_DISPUTE_CLOSED",
      targetType: "StripeDispute",
      targetId: event.stripeDisputeRecordId,
      metadata: {
        stripeDisputeId: event.stripeDisputeId,
        paymentId: event.paymentId,
        jobId: event.jobId,
        outcome: event.outcome,
        amount: event.amount,
        currency: event.currency,
        financialAdjustmentId: event.financialAdjustmentId,
      },
    });
  }
}
