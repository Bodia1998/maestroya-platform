import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { DisputeFinancialOutcomeDetermined } from "@/domain/events/dispute-financial-outcome-determined";
import type { EventHandler } from "@/application/ports/event-bus";

/**
 * Module 68 — Dispute Resolution & Financial Protection: the audit-log
 * subscriber for `DisputeFinancialOutcomeDetermined`, mirroring
 * `RecordDisputeStatusChangeAuditLogSubscriber` (Module 37) exactly —
 * translates the event into the existing `AdminAuditLogRepository.record`
 * call, no business logic. This is the immutable audit record the module's
 * brief requires: who decided, which dispute/job/payment, what decision,
 * what financial outcome, and the resulting status — all already carried
 * by the event; this subscriber only persists them.
 */
export class RecordDisputeFinancialOutcomeAuditLogSubscriber implements EventHandler<DisputeFinancialOutcomeDetermined> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: DisputeFinancialOutcomeDetermined): Promise<void> {
    await this.auditLog.record({
      adminUserId: event.decidedByUserId,
      action: "DISPUTE_RESOLUTION_FINANCIAL_OUTCOME_DETERMINED",
      targetType: "DisputeResolutionDecision",
      targetId: event.decisionId,
      metadata: {
        disputeId: event.disputeId,
        jobId: event.jobId,
        resolution: event.resolution,
        outcome: event.outcome,
        finalStatus: event.finalStatus,
      },
    });
  }
}
