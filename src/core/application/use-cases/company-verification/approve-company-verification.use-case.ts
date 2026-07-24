import { ConflictError, NotFoundError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CompanyRepository } from "@/domain/repositories/company-repository";
import type { CompanyVerificationRecord, CompanyVerificationRepository } from "@/domain/repositories/company-verification-repository";
import { canApprove, canTransition, computeExpiresAt } from "@/domain/services/company-verification-rules";
import type { NotificationCreator } from "@/application/ports/notification-creator";

/** Module 18 — Company Professional: an admin approves a case
 *  (PENDING/UNDER_REVIEW → APPROVED). Flips CompanyProfile.isVerified,
 *  notifies the company's owner. Mirrors ApproveProfessionalVerificationUseCase. */
export class ApproveCompanyVerificationUseCase {
  constructor(
    private readonly verifications: CompanyVerificationRepository,
    private readonly companies: CompanyRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator,
  ) {}

  async execute(adminUserId: string, verificationId: string): Promise<CompanyVerificationRecord> {
    const verification = await this.verifications.findById(verificationId);
    if (!verification) {
      throw new NotFoundError("CompanyVerification", verificationId);
    }

    if (!canApprove(verification.status) || !canTransition(verification.status, "APPROVED")) {
      throw new ConflictError("This verification request cannot be approved in its current state.");
    }

    const now = new Date();
    const updated = await this.verifications.updateStatus(verificationId, {
      status: "APPROVED",
      reviewedByUserId: adminUserId,
      reviewedAt: now,
      expiresAt: computeExpiresAt(now),
      rejectionReason: null,
      resubmissionReason: null,
    });

    await this.verifications.setCompanyVerifiedStatus(verification.companyProfileId, true, now);

    await this.auditLog.record({
      adminUserId,
      action: "COMPANY_VERIFICATION_APPROVED",
      targetType: "CompanyVerification",
      targetId: verificationId,
      metadata: { companyProfileId: verification.companyProfileId },
    });

    const company = await this.companies.findById(verification.companyProfileId);
    if (company) {
      try {
        await this.notifications.notify({
          userId: company.ownerUserId,
          type: "COMPANY_VERIFICATION_APPROVED",
          title: "Your company is now verified",
          message: "Your company's verification has been approved. A verified badge now appears on its public profile.",
          resourceType: "COMPANY_VERIFICATION",
          resourceId: verificationId,
          actionUrl: "/dashboard/company/verification",
        });
      } catch (error) {
        console.error("Failed to create company-verification-approved notification", error);
      }
    }

    return updated;
  }
}
