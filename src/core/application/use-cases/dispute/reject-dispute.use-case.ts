import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { DisputeRecord, DisputeRepository } from "@/domain/repositories/dispute-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { isRejectableStatus } from "@/domain/services/dispute-state";
import { resolveDisputeParticipantUserIds } from "@/application/use-cases/dispute/resolve-dispute-participant-user-ids";

/**
 * Module 21 — Disputes & Support: rejects a Dispute (declines to uphold it
 * — e.g. it was invalid, out of scope, or a duplicate). Distinct from
 * ResolveDisputeUseCase: a rejected dispute has no `resolution` outcome
 * (Dispute.resolution stays null) — REJECTED means "there is nothing for
 * Module 22 to act on", not "the customer/professional was favored". Sets
 * `resolutionNote` to the rejection reason for the audit trail. Admin-only.
 */
export class RejectDisputeUseCase {
  constructor(
    private readonly disputes: DisputeRepository,
    private readonly jobs: JobRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly companyMembers: CompanyMembershipRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
  ) {}

  async execute(adminUserId: string, disputeId: string, resolutionNote: string): Promise<DisputeRecord> {
    const dispute = await this.disputes.findById(disputeId);
    if (!dispute) {
      throw new NotFoundError("Dispute", disputeId);
    }

    if (!isRejectableStatus(dispute.status)) {
      throw new ValidationError(`Cannot reject a dispute in status ${dispute.status}.`);
    }

    const updated = await this.disputes.updateStatus(disputeId, dispute.status, {
      status: "REJECTED",
      resolutionNote,
      resolvedAt: new Date(),
      resolvedByUserId: adminUserId,
    });

    try {
      await this.auditLog.record({
        adminUserId,
        action: "DISPUTE_REJECTED",
        targetType: "Dispute",
        targetId: disputeId,
        metadata: {},
      });
    } catch (error) {
      console.error("Failed to record dispute-rejected audit log", error);
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
            type: "DISPUTE_REJECTED",
            title: "Your dispute was rejected",
            message: `Dispute ${updated.caseNumber} has been rejected.`,
            resourceType: "DISPUTE",
            resourceId: updated.id,
            actionUrl: `/disputes/${updated.id}`,
            metadata: { caseNumber: updated.caseNumber },
          });
        }
      }
    } catch (error) {
      console.error("Failed to create dispute-rejected notification", error);
    }

    return updated;
  }
}
