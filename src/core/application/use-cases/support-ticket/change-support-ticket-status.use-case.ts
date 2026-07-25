import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type {
  SupportTicketRecord,
  SupportTicketRepository,
  SupportTicketStatusValue,
} from "@/domain/repositories/support-ticket-repository";
import { canTransitionSupportTicketStatus } from "@/domain/services/support-ticket-state";

/**
 * Module 21 — Disputes & Support: admin-only generic status transition for
 * SupportTicket — covers OPEN -> IN_PROGRESS and IN_PROGRESS <->
 * WAITING_FOR_USER. RESOLVED/CLOSED each have their own dedicated use case
 * (ResolveSupportTicketUseCase/CloseSupportTicketUseCase), mirroring
 * ChangeDisputeStatusUseCase's own split and its reasoning.
 */
export class ChangeSupportTicketStatusUseCase {
  constructor(
    private readonly tickets: SupportTicketRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
  ) {}

  async execute(adminUserId: string, ticketId: string, nextStatus: SupportTicketStatusValue): Promise<SupportTicketRecord> {
    if (nextStatus === "RESOLVED" || nextStatus === "CLOSED") {
      throw new ValidationError("Use the resolve/close action for this transition — it requires a resolution note.");
    }

    const ticket = await this.tickets.findById(ticketId);
    if (!ticket) {
      throw new NotFoundError("SupportTicket", ticketId);
    }

    if (!canTransitionSupportTicketStatus(ticket.status, nextStatus)) {
      throw new ValidationError(`Cannot move a ticket from ${ticket.status} to ${nextStatus}.`);
    }

    const updated = await this.tickets.updateStatus(ticketId, ticket.status, { status: nextStatus });

    try {
      await this.auditLog.record({
        adminUserId,
        action: "SUPPORT_TICKET_STATUS_CHANGED",
        targetType: "SupportTicket",
        targetId: ticketId,
        metadata: { from: ticket.status, to: nextStatus },
      });
    } catch (error) {
      console.error("Failed to record support-ticket-status-changed audit log", error);
    }

    try {
      await this.notifications.notify({
        userId: ticket.openedByUserId,
        type: "SUPPORT_TICKET_STATUS_CHANGED",
        title: "Your support ticket was updated",
        message: `Ticket ${updated.ticketNumber} is now ${nextStatus.replaceAll("_", " ").toLowerCase()}.`,
        resourceType: "SUPPORT_TICKET",
        resourceId: updated.id,
        actionUrl: `/support-tickets/${updated.id}`,
        metadata: { ticketNumber: updated.ticketNumber, status: nextStatus },
      });
    } catch (error) {
      console.error("Failed to create support-ticket-status-changed notification", error);
    }

    return updated;
  }
}
