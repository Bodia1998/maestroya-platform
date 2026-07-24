import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CompanyRepository } from "@/domain/repositories/company-repository";
import type { CompanyVerificationRecord, CompanyVerificationRepository } from "@/domain/repositories/company-verification-repository";
import { canRequestResubmission, canTransition, isValidReviewReason } from "@/domain/services/company-verification-rules";
import type { NotificationCreator } from "@/application/ports/notification-creator";

/** Module 18 — Company Professional: an admin asks for a resubmission
 *  (a reason is required). Mirrors RequestVerificationResubmissionUseCase. */
export class RequestCompanyVerificationResubmissionUseCase {
  constructor(
    private readonly verifications: CompanyVerificationRepository,
    private readonly companies: CompanyRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator,
  ) {}

  async execute(adminUserId: string, verificationId: string, reason: string): Promise<CompanyVerificationRecord> {
    if (!isValidReviewReason(reason)) {
      throw new ValidationError("A resubmission reason of 10–1000 characters is required.");
    }

    const verification = await this.verifications.findById(verificationId);
    if (!verification) {
      throw new NotFoundError("CompanyVerification", verificationId);
    }

    if (!canRequestResubmission(verification.status) || !canTransition(verification.status, "RESUBMISSION_REQUIRED")) {
      throw new ConflictError("This verification request cannot request a resubmission in its current state.");
    }

    const updated = await this.verifications.updateStatus(verificationId, {
      status: "RESUBMISSION_REQUIRED",
      reviewedByUserId: adminUserId,
      reviewedAt: new Date(),
      resubmissionReason: reason.trim(),
      rejectionReason: null,
    });

    await this.auditLog.record({
      adminUserId,
      action: "COMPANY_VERIFICATION_RESUBMISSION_REQUESTED",
      targetType: "CompanyVerification",
      targetId: verificationId,
      metadata: { companyProfileId: verification.companyProfileId },
    });

    const company = await this.companies.findById(verification.companyProfileId);
    if (company) {
      try {
        await this.notifications.notify({
          userId: company.ownerUserId,
          type: "COMPANY_VERIFICATION_RESUBMISSION_REQUIRED",
          title: "Resubmission required",
          message: "Your company's verification request needs changes before it can be approved.",
          resourceType: "COMPANY_VERIFICATION",
          resourceId: verificationId,
          actionUrl: "/dashboard/company/verification",
        });
      } catch (error) {
        console.error("Failed to create company-verification-resubmission-required notification", error);
      }
    }

    return updated;
  }
}
