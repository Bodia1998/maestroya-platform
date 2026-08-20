import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { EventHandler } from "@/application/ports/event-bus";
import type { PaymentRefunded } from "@/domain/events/payment-refunded";
import type { RefundFailed } from "@/domain/events/refund-failed";
import type { ProfessionalPayoutReversed } from "@/domain/events/professional-payout-reversed";
import type { PayoutReversalFailed } from "@/domain/events/payout-reversal-failed";

/**
 * Module 77 — Refund & Dispute Financial Execution: audit-log subscribers
 * for this module's four events, mirroring
 * `RecordDisputeFinancialOutcomeAuditLogSubscriber` (Module 68) exactly —
 * translates each event into the existing `AdminAuditLogRepository.record`
 * call, no business logic. `adminUserId: null` — these events are raised
 * by system-executed Stripe operations, not a direct admin action (the
 * admin's own id is already recorded on the
 * `DISPUTE_RESOLUTION_FINANCIAL_OUTCOME_DETERMINED` entry that triggered
 * this refund — see that subscriber's own doc comment), the same "system-
 * triggered entry with no human actor" case `RecordAdminAuditLogData.
 * adminUserId`'s own doc comment already documents.
 */
export class RecordPaymentRefundedAuditLogSubscriber implements EventHandler<PaymentRefunded> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: PaymentRefunded): Promise<void> {
    await this.auditLog.record({
      adminUserId: null,
      action: "PAYMENT_REFUNDED",
      targetType: "Refund",
      targetId: event.refundId,
      metadata: {
        paymentId: event.paymentId,
        jobId: event.jobId,
        financialAdjustmentId: event.financialAdjustmentId,
        amount: event.amount,
        currency: event.currency,
        newPaymentStatus: event.newPaymentStatus,
        stripeRefundId: event.stripeRefundId,
      },
    });
  }
}

export class RecordRefundFailedAuditLogSubscriber implements EventHandler<RefundFailed> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: RefundFailed): Promise<void> {
    await this.auditLog.record({
      adminUserId: null,
      action: "REFUND_FAILED",
      targetType: "Refund",
      targetId: event.refundId,
      metadata: {
        paymentId: event.paymentId,
        jobId: event.jobId,
        financialAdjustmentId: event.financialAdjustmentId,
        reason: event.reason,
      },
    });
  }
}

export class RecordProfessionalPayoutReversedAuditLogSubscriber implements EventHandler<ProfessionalPayoutReversed> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: ProfessionalPayoutReversed): Promise<void> {
    await this.auditLog.record({
      adminUserId: null,
      action: "PROFESSIONAL_PAYOUT_REVERSED",
      targetType: "Payout",
      targetId: event.payoutId,
      metadata: {
        jobId: event.jobId,
        paymentId: event.paymentId,
        professionalProfileId: event.professionalProfileId,
        companyProfileId: event.companyProfileId,
        reversedAmount: event.reversedAmount,
        currency: event.currency,
        stripeReversalId: event.stripeReversalId,
      },
    });
  }
}

export class RecordPayoutReversalFailedAuditLogSubscriber implements EventHandler<PayoutReversalFailed> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: PayoutReversalFailed): Promise<void> {
    await this.auditLog.record({
      adminUserId: null,
      action: "PAYOUT_REVERSAL_FAILED",
      targetType: "Payout",
      targetId: event.payoutId,
      metadata: {
        jobId: event.jobId,
        paymentId: event.paymentId,
        reason: event.reason,
      },
    });
  }
}
