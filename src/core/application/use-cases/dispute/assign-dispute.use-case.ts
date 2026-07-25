import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { NotFoundError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { DisputeRecord, DisputeRepository } from "@/domain/repositories/dispute-repository";

/**
 * Module 21 — Disputes & Support: assigns (or unassigns, when
 * `adminUserId` is null) a Dispute to an admin/support agent. Admin-only —
 * trusts the caller has already been authorized via
 * `requireRole(ADMIN, SUPER_ADMIN, SUPPORT)` at the Server Action boundary.
 */
export class AssignDisputeUseCase {
  constructor(
    private readonly disputes: DisputeRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
  ) {}

  async execute(adminUserId: string, disputeId: string, assigneeUserId: string | null): Promise<DisputeRecord> {
    const existing = await this.disputes.findById(disputeId);
    if (!existing) {
      throw new NotFoundError("Dispute", disputeId);
    }

    const updated = await this.disputes.assign(disputeId, assigneeUserId);

    try {
      await this.auditLog.record({
        adminUserId,
        action: "DISPUTE_ASSIGNED",
        targetType: "Dispute",
        targetId: disputeId,
        metadata: { previousAssignee: existing.assignedAdminUserId, newAssignee: assigneeUserId },
      });
    } catch (error) {
      console.error("Failed to record dispute-assigned audit log", error);
    }

    if (assigneeUserId) {
      try {
        await this.notifications.notify({
          userId: assigneeUserId,
          type: "DISPUTE_ASSIGNED",
          title: "A dispute was assigned to you",
          message: `Dispute ${updated.caseNumber} was assigned to you.`,
          resourceType: "DISPUTE",
          resourceId: updated.id,
          actionUrl: `/admin/disputes/${updated.id}`,
          metadata: { caseNumber: updated.caseNumber },
        });
      } catch (error) {
        console.error("Failed to create dispute-assigned notification", error);
      }
    }

    return updated;
  }
}
