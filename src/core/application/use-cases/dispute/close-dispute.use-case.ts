import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { DisputeRecord, DisputeRepository } from "@/domain/repositories/dispute-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { isClosableStatus } from "@/domain/services/dispute-state";
import { resolveDisputeParticipantUserIds } from "@/application/use-cases/dispute/resolve-dispute-participant-user-ids";

/**
 * Module 21 — Disputes & Support: closes a Dispute — only reachable from
 * RESOLVED or REJECTED (see dispute-state.ts). Admin-only, no auto-close
 * after N days in this module (explicit MVP decision — SLA automation is
 * out of scope, see docs/MODULE_21_DISPUTES_SUPPORT.md). CLOSED is
 * terminal: reopening a closed dispute is not supported (documented
 * limitation).
 */
export class CloseDisputeUseCase {
  constructor(
    private readonly disputes: DisputeRepository,
    private readonly jobs: JobRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly companyMembers: CompanyMembershipRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
  ) {}

  async execute(adminUserId: string, disputeId: string): Promise<DisputeRecord> {
    const dispute = await this.disputes.findById(disputeId);
    if (!dispute) {
      throw new NotFoundError("Dispute", disputeId);
    }

    if (!isClosableStatus(dispute.status)) {
      throw new ValidationError(`Cannot close a dispute in status ${dispute.status}.`);
    }

    const updated = await this.disputes.updateStatus(disputeId, dispute.status, {
      status: "CLOSED",
      closedAt: new Date(),
      closedByUserId: adminUserId,
    });

    try {
      await this.auditLog.record({
        adminUserId,
        action: "DISPUTE_CLOSED",
        targetType: "Dispute",
        targetId: disputeId,
        metadata: {},
      });
    } catch (error) {
      console.error("Failed to record dispute-closed audit log", error);
    }

    try {
      const job = await this.jobs.findById(dispute.jobId);
      if (job) {
        const userIds = await resolveDisputeParticipantUserIds(job, {
          customerProfiles: this.customerProfiles,
          professionals: this.professionals,
          companyMembers: this.companyMembers,
        });
        for (const userId of userIds) {
          await this.notifications.notify({
            userId,
            type: "DISPUTE_CLOSED",
            title: "Your dispute was closed",
            message: `Dispute ${updated.caseNumber} has been closed.`,
            resourceType: "DISPUTE",
            resourceId: updated.id,
            actionUrl: `/disputes/${updated.id}`,
            metadata: { caseNumber: updated.caseNumber },
          });
        }
      }
    } catch (error) {
      console.error("Failed to create dispute-closed notification", error);
    }

    return updated;
  }
}
