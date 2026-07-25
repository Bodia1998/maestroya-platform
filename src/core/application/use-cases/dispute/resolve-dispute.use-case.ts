import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type {
  DisputeRecord,
  DisputeRepository,
  DisputeResolutionValue,
} from "@/domain/repositories/dispute-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { isResolvableStatus } from "@/domain/services/dispute-state";
import { resolveDisputeParticipantUserIds } from "@/application/use-cases/dispute/resolve-dispute-participant-user-ids";

export interface ResolveDisputeInput {
  resolution: DisputeResolutionValue;
  resolutionNote: string;
}

/**
 * Module 21 — Disputes & Support: resolves a Dispute — the one place
 * `Dispute.resolution` is ever set. Records a *business-level* outcome only
 * (see DisputeResolutionValue's doc comment on schema.prisma) — this use
 * case never touches Stripe, never calculates a refund/commission amount,
 * never moves money. A future Module 22 is expected to read
 * `resolution`/`resolutionNote` off a RESOLVED dispute and execute the
 * actual financial settlement, entirely outside this module.
 *
 * Admin-only — trusts the caller has already been authorized via
 * `requireRole(ADMIN, SUPER_ADMIN, SUPPORT)` at the Server Action boundary.
 * Does NOT close the case — RESOLVED and CLOSED are deliberately distinct
 * (see dispute-state.ts's own doc comment); a separate admin action
 * (CloseDisputeUseCase) closes it.
 */
export class ResolveDisputeUseCase {
  constructor(
    private readonly disputes: DisputeRepository,
    private readonly jobs: JobRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly companyMembers: CompanyMembershipRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
  ) {}

  async execute(adminUserId: string, disputeId: string, input: ResolveDisputeInput): Promise<DisputeRecord> {
    const dispute = await this.disputes.findById(disputeId);
    if (!dispute) {
      throw new NotFoundError("Dispute", disputeId);
    }

    if (!isResolvableStatus(dispute.status)) {
      throw new ValidationError(`Cannot resolve a dispute in status ${dispute.status}.`);
    }

    const updated = await this.disputes.updateStatus(disputeId, dispute.status, {
      status: "RESOLVED",
      resolution: input.resolution,
      resolutionNote: input.resolutionNote,
      resolvedAt: new Date(),
      resolvedByUserId: adminUserId,
    });

    try {
      await this.auditLog.record({
        adminUserId,
        action: "DISPUTE_RESOLVED",
        targetType: "Dispute",
        targetId: disputeId,
        // Deliberately no full resolutionNote/evidence content dumped into
        // metadata (see the module spec's "do not log sensitive data
        // unnecessarily" requirement) — just the outcome enum, which is
        // never sensitive.
        metadata: { resolution: input.resolution },
      });
    } catch (error) {
      console.error("Failed to record dispute-resolved audit log", error);
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
            type: "DISPUTE_RESOLVED",
            title: "Your dispute was resolved",
            message: `Dispute ${updated.caseNumber} has been resolved.`,
            resourceType: "DISPUTE",
            resourceId: updated.id,
            actionUrl: `/disputes/${updated.id}`,
            metadata: { caseNumber: updated.caseNumber, resolution: input.resolution },
          });
        }
      }
    } catch (error) {
      console.error("Failed to create dispute-resolved notification", error);
    }

    return updated;
  }
}
