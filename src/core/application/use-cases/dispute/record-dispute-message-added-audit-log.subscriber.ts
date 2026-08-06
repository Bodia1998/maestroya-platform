import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { DisputeMessageAdded } from "@/domain/events/dispute-message-added";
import type { EventHandler } from "@/application/ports/event-bus";

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * The `AuditLogSubscriber` for `DisputeMessageAdded`
 * (`domain/events/dispute-message-added.ts`) — reacts to the event by
 * writing exactly the same `AdminAuditLogRepository.record` call
 * `AddDisputeMessageUseCase` used to make directly. No message body in
 * metadata — messages are already visible in the dispute thread itself
 * (see the use case's own pre-Module-37 comment) — just the message id.
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `dispute/compose.ts`.
 */
export class RecordDisputeMessageAddedAuditLogSubscriber implements EventHandler<DisputeMessageAdded> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: DisputeMessageAdded): Promise<void> {
    await this.auditLog.record({
      adminUserId: event.actorUserId,
      action: "DISPUTE_MESSAGE_ADDED",
      targetType: "Dispute",
      targetId: event.disputeId,
      metadata: { messageId: event.messageId },
    });
  }
}
