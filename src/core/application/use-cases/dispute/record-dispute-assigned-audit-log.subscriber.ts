import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { DisputeAssigned } from "@/domain/events/dispute-assigned";
import type { EventHandler } from "@/application/ports/event-bus";

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * The `AuditLogSubscriber` for `DisputeAssigned`
 * (`domain/events/dispute-assigned.ts`) — reacts to the event by writing
 * exactly the same `AdminAuditLogRepository.record` call
 * `AssignDisputeUseCase` used to make directly, reproducing its
 * `{ previousAssignee, newAssignee }` metadata byte for byte.
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `dispute/compose.ts`.
 */
export class RecordDisputeAssignedAuditLogSubscriber implements EventHandler<DisputeAssigned> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: DisputeAssigned): Promise<void> {
    await this.auditLog.record({
      adminUserId: event.actorUserId,
      action: "DISPUTE_ASSIGNED",
      targetType: "Dispute",
      targetId: event.disputeId,
      metadata: { previousAssignee: event.previousAssigneeUserId, newAssignee: event.newAssigneeUserId },
    });
  }
}
