import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { DisputeRecord, DisputeRepository, DisputeStatusValue } from "@/domain/repositories/dispute-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { canTransitionDisputeStatus } from "@/domain/services/dispute-state";
import { resolveDisputeParticipantUserIds } from "@/application/use-cases/dispute/resolve-dispute-participant-user-ids";

/**
 * Module 21 — Disputes & Support: admin-only generic status transition —
 * covers OPEN -> UNDER_REVIEW and UNDER_REVIEW <-> WAITING_FOR_CUSTOMER/
 * WAITING_FOR_PROFESSIONAL (the "request info from a party" workflow step).
 * RESOLVED/REJECTED/CLOSED each have their own dedicated use case
 * (ResolveDisputeUseCase/RejectDisputeUseCase/CloseDisputeUseCase) since
 * those three require additional fields (resolution/resolutionNote) this
 * generic transition does not collect — this use case explicitly refuses
 * to write RESOLVED/REJECTED/CLOSED itself (see the guard below) so there
 * is exactly one code path that ever sets Dispute.resolution.
 *
 * Every transition (including admin-initiated ones — the module spec's
 * "can admins override normal transitions" answer) still goes through
 * `canTransitionDisputeStatus`, never a raw field write. Trusts the caller
 * has already been authorized via `requireRole(ADMIN, SUPER_ADMIN,
 * SUPPORT)` at the Server Action boundary.
 */
export class ChangeDisputeStatusUseCase {
  constructor(
    private readonly disputes: DisputeRepository,
    private readonly jobs: JobRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly companyMembers: CompanyMembershipRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
  ) {}

  async execute(adminUserId: string, disputeId: string, nextStatus: DisputeStatusValue): Promise<DisputeRecord> {
    if (nextStatus === "RESOLVED" || nextStatus === "REJECTED" || nextStatus === "CLOSED") {
      throw new ValidationError(
        "Use the resolve/reject/close action for this transition — it requires a resolution note.",
      );
    }

    const dispute = await this.disputes.findById(disputeId);
    if (!dispute) {
      throw new NotFoundError("Dispute", disputeId);
    }

    if (!canTransitionDisputeStatus(dispute.status, nextStatus)) {
      throw new ValidationError(`Cannot move a dispute from ${dispute.status} to ${nextStatus}.`);
    }

    const updated = await this.disputes.updateStatus(disputeId, dispute.status, { status: nextStatus });

    try {
      await this.auditLog.record({
        adminUserId,
        action: "DISPUTE_STATUS_CHANGED",
        targetType: "Dispute",
        targetId: disputeId,
        metadata: { from: dispute.status, to: nextStatus },
      });
    } catch (error) {
      console.error("Failed to record dispute-status-changed audit log", error);
    }

    try {
      const job = await this.jobs.findById(dispute.jobId);
      if (job) {
        const userIds = await resolveDisputeParticipantUserIds(job, {
          customerProfiles: this.customerProfiles,
          professionals: this.professionals,
          companyMembers: this.companyMembers,
        });
        const isResponseRequest = nextStatus === "WAITING_FOR_CUSTOMER" || nextStatus === "WAITING_FOR_PROFESSIONAL";
        for (const userId of userIds) {
          await this.notifications.notify({
            userId,
            type: isResponseRequest ? "DISPUTE_RESPONSE_REQUESTED" : "DISPUTE_STATUS_CHANGED",
            title: isResponseRequest ? "Response requested on your dispute" : "Dispute status updated",
            message: `Dispute ${updated.caseNumber} is now ${nextStatus.replaceAll("_", " ").toLowerCase()}.`,
            resourceType: "DISPUTE",
            resourceId: updated.id,
            actionUrl: `/disputes/${updated.id}`,
            metadata: { caseNumber: updated.caseNumber, status: nextStatus },
          });
        }
      }
    } catch (error) {
      console.error("Failed to create dispute-status-changed notification", error);
    }

    return updated;
  }
}
