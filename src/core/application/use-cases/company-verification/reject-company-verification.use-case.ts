import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CompanyRepository } from "@/domain/repositories/company-repository";
import type { CompanyVerificationRecord, CompanyVerificationRepository } from "@/domain/repositories/company-verification-repository";
import { canReject, canTransition, isValidReviewReason } from "@/domain/services/company-verification-rules";
import type { NotificationCreator } from "@/application/ports/notification-creator";

/** Module 18 — Company Professional: an admin rejects a case (a reason is
 *  required, 10–1000 chars). Mirrors RejectProfessionalVerificationUseCase. */
export class RejectCompanyVerificationUseCase {
  constructor(
    private readonly verifications: CompanyVerificationRepository,
    private readonly companies: CompanyRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator,
  ) {}

  async execute(adminUserId: string, verificationId: string, reason: string): Promise<CompanyVerificationRecord> {
    if (!isValidReviewReason(reason)) {
      throw new ValidationError("A rejection reason of 10–1000 characters is required.");
    }

    const verification = await this.verifications.findById(verificationId);
    if (!verification) {
      throw new NotFoundError("CompanyVerification", verificationId);
    }

    if (!canReject(verification.status) || !canTransition(verification.status, "REJECTED")) {
      throw new ConflictError("This verification request cannot be rejected in its current state.");
    }

    const updated = await this.verifications.updateStatus(verificationId, {
      status: "REJECTED",
      reviewedByUserId: adminUserId,
      reviewedAt: new Date(),
      rejectionReason: reason.trim(),
      resubmissionReason: null,
    });

    await this.auditLog.record({
      adminUserId,
      action: "COMPANY_VERIFICATION_REJECTED",
      targetType: "CompanyVerification",
      targetId: verificationId,
      metadata: { companyProfileId: verification.companyProfileId },
    });

    const company = await this.companies.findById(verification.companyProfileId);
    if (company) {
      try {
        await this.notifications.notify({
          userId: company.ownerUserId,
          type: "COMPANY_VERIFICATION_REJECTED",
          title: "Verification request rejected",
          message: "Your company's verification request was rejected. See the details for the reason.",
          resourceType: "COMPANY_VERIFICATION",
          resourceId: verificationId,
          actionUrl: "/dashboard/company/verification",
        });
      } catch (error) {
        console.error("Failed to create company-verification-rejected notification", error);
      }
    }

    return updated;
  }
}
