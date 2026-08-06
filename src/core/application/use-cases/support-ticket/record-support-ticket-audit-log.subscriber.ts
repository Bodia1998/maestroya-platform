import type { AdminAuditAction, AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { SupportTicketStatusChanged } from "@/domain/events/support-ticket-status-changed";
import type { EventHandler } from "@/application/ports/event-bus";

const ACTION_FOR_TRANSITION: Record<SupportTicketStatusChanged["transition"], AdminAuditAction> = {
  ASSIGNED: "SUPPORT_TICKET_ASSIGNED",
  STATUS_CHANGED: "SUPPORT_TICKET_STATUS_CHANGED",
  RESOLVED: "SUPPORT_TICKET_RESOLVED",
  CLOSED: "SUPPORT_TICKET_CLOSED",
};

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * The `AuditLogSubscriber` for `SupportTicketStatusChanged`
 * (`domain/events/support-ticket-status-changed.ts`) — mirrors
 * `RecordProfessionalVerificationAuditLogSubscriber` exactly. Reacts to the
 * event by writing exactly the same `AdminAuditLogRepository.record` call
 * `AssignSupportTicketUseCase`/`ChangeSupportTicketStatusUseCase`/
 * `ResolveSupportTicketUseCase`/`CloseSupportTicketUseCase` used to make
 * directly — no business logic here, just translating the event's fields
 * into `RecordAdminAuditLogData` and delegating to the existing repository.
 *
 * `metadata` reproduces each use case's own pre-Module-37 metadata byte for
 * byte: `{ previousAssignee, newAssignee }` for ASSIGNED (note the field
 * names — `previousAssignee`/`newAssignee`, not
 * `previousAssigneeUserId`/`newAssigneeUserId`, since the event's own field
 * names changed but the recorded audit metadata shape must not),
 * `{ from, to }` for STATUS_CHANGED, `{}` for RESOLVED/CLOSED.
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `support-ticket/compose.ts`,
 * following the exact registration pattern `verification/compose.ts`
 * documents.
 *
 * A thrown error here is caught by `SynchronousEventBus.publish` and
 * surfaces to the publishing use case as part of an `EventDispatchError` —
 * it never corrupts the ticket's already-persisted change.
 */
export class RecordSupportTicketAuditLogSubscriber implements EventHandler<SupportTicketStatusChanged> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: SupportTicketStatusChanged): Promise<void> {
    const metadata =
      event.transition === "ASSIGNED"
        ? { previousAssignee: event.previousAssigneeUserId, newAssignee: event.newAssigneeUserId }
        : event.transition === "STATUS_CHANGED"
          ? { from: event.previousStatus, to: event.newStatus }
          : {};

    await this.auditLog.record({
      adminUserId: event.actorUserId,
      action: ACTION_FOR_TRANSITION[event.transition],
      targetType: "SupportTicket",
      targetId: event.ticketId,
      metadata,
    });
  }
}
