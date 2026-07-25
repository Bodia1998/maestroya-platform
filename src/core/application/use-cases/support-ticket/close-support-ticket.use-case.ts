import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { SupportTicketRecord, SupportTicketRepository } from "@/domain/repositories/support-ticket-repository";
import { isClosableStatus } from "@/domain/services/support-ticket-state";

/** Module 21 — Disputes & Support: closes a SupportTicket — only reachable
 *  from RESOLVED. Admin-only. */
export class CloseSupportTicketUseCase {
  constructor(
    private readonly tickets: SupportTicketRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
  ) {}

  async execute(adminUserId: string, ticketId: string): Promise<SupportTicketRecord> {
    const ticket = await this.tickets.findById(ticketId);
    if (!ticket) {
      throw new NotFoundError("SupportTicket", ticketId);
    }

    if (!isClosableStatus(ticket.status)) {
      throw new ValidationError(`Cannot close a ticket in status ${ticket.status}.`);
    }

    const updated = await this.tickets.updateStatus(ticketId, ticket.status, {
      status: "CLOSED",
      closedAt: new Date(),
      closedByUserId: adminUserId,
    });

    try {
      await this.auditLog.record({
        adminUserId,
        action: "SUPPORT_TICKET_CLOSED",
        targetType: "SupportTicket",
        targetId: ticketId,
        metadata: {},
      });
    } catch (error) {
      console.error("Failed to record support-ticket-closed audit log", error);
    }

    try {
      await this.notifications.notify({
        userId: ticket.openedByUserId,
        type: "SUPPORT_TICKET_CLOSED",
        title: "Your support ticket was closed",
        message: `Ticket ${updated.ticketNumber} has been closed.`,
        resourceType: "SUPPORT_TICKET",
        resourceId: updated.id,
        actionUrl: `/support-tickets/${updated.id}`,
        metadata: { ticketNumber: updated.ticketNumber },
      });
    } catch (error) {
      console.error("Failed to create support-ticket-closed notification", error);
    }

    return updated;
  }
}
