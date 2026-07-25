import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { SupportTicketRecord, SupportTicketRepository } from "@/domain/repositories/support-ticket-repository";
import { isResolvableStatus } from "@/domain/services/support-ticket-state";

/** Module 21 — Disputes & Support: resolves a SupportTicket. Admin-only. */
export class ResolveSupportTicketUseCase {
  constructor(
    private readonly tickets: SupportTicketRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
  ) {}

  async execute(adminUserId: string, ticketId: string, resolutionNote: string): Promise<SupportTicketRecord> {
    const ticket = await this.tickets.findById(ticketId);
    if (!ticket) {
      throw new NotFoundError("SupportTicket", ticketId);
    }

    if (!isResolvableStatus(ticket.status)) {
      throw new ValidationError(`Cannot resolve a ticket in status ${ticket.status}.`);
    }

    const updated = await this.tickets.updateStatus(ticketId, ticket.status, {
      status: "RESOLVED",
      resolutionNote,
      resolvedAt: new Date(),
      resolvedByUserId: adminUserId,
    });

    try {
      await this.auditLog.record({
        adminUserId,
        action: "SUPPORT_TICKET_RESOLVED",
        targetType: "SupportTicket",
        targetId: ticketId,
        metadata: {},
      });
    } catch (error) {
      console.error("Failed to record support-ticket-resolved audit log", error);
    }

    try {
      await this.notifications.notify({
        userId: ticket.openedByUserId,
        type: "SUPPORT_TICKET_RESOLVED",
        title: "Your support ticket was resolved",
        message: `Ticket ${updated.ticketNumber} has been resolved.`,
        resourceType: "SUPPORT_TICKET",
        resourceId: updated.id,
        actionUrl: `/support-tickets/${updated.id}`,
        metadata: { ticketNumber: updated.ticketNumber },
      });
    } catch (error) {
      console.error("Failed to create support-ticket-resolved notification", error);
    }

    return updated;
  }
}
