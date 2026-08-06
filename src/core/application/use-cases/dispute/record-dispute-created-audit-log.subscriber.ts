import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { DisputeCreated } from "@/domain/events/dispute-created";
import type { EventHandler } from "@/application/ports/event-bus";

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * The `AuditLogSubscriber` for `DisputeCreated`
 * (`domain/events/dispute-created.ts`) — reacts to the event by writing
 * exactly the same `AdminAuditLogRepository.record` call
 * `CreateDisputeUseCase` used to make directly, reproducing its
 * `{ jobId, caseNumber, reason }` metadata byte for byte.
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `dispute/compose.ts`.
 */
export class RecordDisputeCreatedAuditLogSubscriber implements EventHandler<DisputeCreated> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: DisputeCreated): Promise<void> {
    await this.auditLog.record({
      adminUserId: event.actorUserId,
      action: "DISPUTE_CREATED",
      targetType: "Dispute",
      targetId: event.disputeId,
      metadata: { jobId: event.jobId, caseNumber: event.caseNumber, reason: event.reason },
    });
  }
}
