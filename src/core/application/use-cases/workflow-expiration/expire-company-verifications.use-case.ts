import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import type { CompanyVerificationRepository } from "@/domain/repositories/company-verification-repository";
import { isVerificationExpirable } from "@/domain/services/verification-expiration-rules";

export interface ExpireCompanyVerificationsResult {
  expiredCount: number;
  ids: string[];
}

/**
 * Module 28 — Workflow Completion: the company-side mirror of
 * ExpireProfessionalVerificationsUseCase — same rule (APPROVED past
 * `expiresAt` -> EXPIRED), same scope boundary (does not touch
 * CompanyProfile.isVerified). Notifies every active company member, same
 * "no single owner-of-a-company-thing to notify" convention
 * CreateDisputeUseCase.resolveRespondentUserIds already uses for
 * company-owned Jobs.
 */
export class ExpireCompanyVerificationsUseCase {
  constructor(
    private readonly verifications: CompanyVerificationRepository,
    private readonly companyMembers: CompanyMembershipRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
  ) {}

  async execute(now: Date): Promise<ExpireCompanyVerificationsResult> {
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
          action: "COMPANY_VERIFICATION_EXPIRED",
          targetType: "CompanyVerification",
          targetId: verification.id,
          metadata: { expiresAt: verification.expiresAt?.toISOString() ?? null },
        });
      } catch (error) {
        console.error("Failed to record company-verification-expired audit log", error);
      }

      try {
        const members = await this.companyMembers.listByCompany(verification.companyProfileId);
        for (const member of members.filter((m) => m.removedAt === null)) {
          await this.notifications.notify({
            userId: member.userId,
            type: "COMPANY_VERIFICATION_EXPIRED",
            title: "Your company's verification has expired",
            message: "Your company's verification has expired. Start a new verification case to keep your trust badge.",
            resourceType: "COMPANY_VERIFICATION",
            resourceId: verification.id,
            actionUrl: "/company/verification",
            metadata: { verificationId: verification.id, companyProfileId: verification.companyProfileId },
          });
        }
      } catch (error) {
        console.error("Failed to create company-verification-expired notification", error);
      }
    }

    return { expiredCount: expiredIds.length, ids: expiredIds };
  }
}
