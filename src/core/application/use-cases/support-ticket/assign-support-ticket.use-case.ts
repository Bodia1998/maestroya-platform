import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { NotFoundError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { SupportTicketRecord, SupportTicketRepository } from "@/domain/repositories/support-ticket-repository";

/** Module 21 — Disputes & Support: assigns/unassigns a SupportTicket to an
 *  admin — mirrors AssignDisputeUseCase. */
export class AssignSupportTicketUseCase {
  constructor(
    private readonly tickets: SupportTicketRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
  ) {}

  async execute(adminUserId: string, ticketId: string, assigneeUserId: string | null): Promise<SupportTicketRecord> {
    const existing = await this.tickets.findById(ticketId);
    if (!existing) {
      throw new NotFoundError("SupportTicket", ticketId);
    }

    const updated = await this.tickets.assign(ticketId, assigneeUserId);

    try {
      await this.auditLog.record({
        adminUserId,
        action: "SUPPORT_TICKET_ASSIGNED",
        targetType: "SupportTicket",
        targetId: ticketId,
        metadata: { previousAssignee: existing.assignedAdminUserId, newAssignee: assigneeUserId },
      });
    } catch (error) {
      console.error("Failed to record support-ticket-assigned audit log", error);
    }

    if (assigneeUserId) {
      try {
        await this.notifications.notify({
          userId: assigneeUserId,
          type: "SUPPORT_TICKET_ASSIGNED",
          title: "A support ticket was assigned to you",
          message: `Ticket ${updated.ticketNumber} was assigned to you.`,
          resourceType: "SUPPORT_TICKET",
          resourceId: updated.id,
          actionUrl: `/admin/support-tickets/${updated.id}`,
          metadata: { ticketNumber: updated.ticketNumber },
        });
      } catch (error) {
        console.error("Failed to create support-ticket-assigned notification", error);
      }
    }

    return updated;
  }
}
