import { NotFoundError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { DisputePriorityValue, DisputeRecord, DisputeRepository } from "@/domain/repositories/dispute-repository";

/** Module 21 — Disputes & Support: sets an admin-assigned triage priority.
 *  Admin-only, no business-rule constraint on which priority can follow
 *  which (any admin may re-triage at any time up to CLOSED). */
export class SetDisputePriorityUseCase {
  constructor(
    private readonly disputes: DisputeRepository,
    private readonly auditLog: AdminAuditLogRepository,
  ) {}

  async execute(adminUserId: string, disputeId: string, priority: DisputePriorityValue): Promise<DisputeRecord> {
    const existing = await this.disputes.findById(disputeId);
    if (!existing) {
      throw new NotFoundError("Dispute", disputeId);
    }

    const updated = await this.disputes.setPriority(disputeId, priority);

    try {
      await this.auditLog.record({
        adminUserId,
        action: "DISPUTE_STATUS_CHANGED",
        targetType: "Dispute",
        targetId: disputeId,
        metadata: { adminAction: "PRIORITY_CHANGED", from: existing.priority, to: priority },
      });
    } catch (error) {
      console.error("Failed to record dispute-priority-changed audit log", error);
    }

    return updated;
  }
}
