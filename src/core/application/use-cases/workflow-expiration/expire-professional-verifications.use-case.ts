import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ProfessionalVerificationRepository } from "@/domain/repositories/professional-verification-repository";
import { isVerificationExpirable } from "@/domain/services/verification-expiration-rules";

export interface ExpireProfessionalVerificationsResult {
  expiredCount: number;
  ids: string[];
}

/**
 * Module 28 — Workflow Completion: batch use case invoked by the daily
 * expiration cron. Transitions every APPROVED ProfessionalVerification case
 * whose `expiresAt` has passed to EXPIRED — this is the only allowed exit
 * from APPROVED per professional-verification-rules.ts's own TRANSITIONS
 * map (APPROVED -> [EXPIRED]), so this use case is the sole caller that
 * fires an already-modeled transition automatically instead of it staying
 * permanently reachable-but-never-taken.
 *
 * Does not touch ProfessionalProfile.verificationStatus (the public trust
 * badge) — same scope boundary CreateProfessionalVerificationUseCase and
 * friends already respect (only ApproveProfessionalVerificationUseCase/
 * RejectProfessionalVerificationUseCase write that field); an expired case
 * does not by itself revoke that flag, which is a deliberate, documented
 * limitation (see docs/MODULE_28_WORKFLOW_COMPLETION.md, "Remaining
 * limitations" — reverting the public badge on expiry is a product
 * decision outside this module's scope, not an oversight).
 */
export class ExpireProfessionalVerificationsUseCase {
  constructor(
    private readonly verifications: ProfessionalVerificationRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
  ) {}

  async execute(now: Date): Promise<ExpireProfessionalVerificationsResult> {
    const candidates = await this.verifications.findExpirable(now);
    const expiredIds: string[] = [];

    for (const verification of candidates) {
      if (!isVerificationExpirable(verification.status, verification.expiresAt, now)) {
        continue;
      }

      await this.verifications.updateStatus(verification.id, { status: "EXPIRED" });
      expiredIds.push(verification.id);

      try {
        await this.auditLog.record({
          adminUserId: null,
          action: "VERIFICATION_EXPIRED",
          targetType: "ProfessionalVerification",
          targetId: verification.id,
          metadata: { expiresAt: verification.expiresAt?.toISOString() ?? null },
        });
      } catch (error) {
        console.error("Failed to record verification-expired audit log", error);
      }

      try {
        const professional = await this.professionals.findById(verification.professionalProfileId);
        if (professional) {
          await this.notifications.notify({
            userId: professional.userId,
            type: "VERIFICATION_EXPIRED",
            title: "Your verification has expired",
            message: "Your professional verification has expired. Start a new verification case to keep your trust badge.",
            resourceType: "PROFESSIONAL_VERIFICATION",
            resourceId: verification.id,
            actionUrl: "/professional/verification",
            metadata: { verificationId: verification.id },
          });
        }
      } catch (error) {
        console.error("Failed to create verification-expired notification", error);
      }
    }

    return { expiredCount: expiredIds.length, ids: expiredIds };
  }
}
