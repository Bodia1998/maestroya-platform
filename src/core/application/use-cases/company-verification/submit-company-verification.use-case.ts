import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import type { CompanyVerificationRecord, CompanyVerificationRepository } from "@/domain/repositories/company-verification-repository";
import { canManageCompanyProfile } from "@/domain/services/company-membership-rules";
import { canSubmit, canTransition, hasRequiredDocuments } from "@/domain/services/company-verification-rules";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

/** Module 18 — Company Professional: submits the company's DRAFT case into
 *  the admin review queue (DRAFT → PENDING). Mirrors
 *  SubmitProfessionalVerificationUseCase — requires at least one business
 *  document (BUSINESS_LICENSE/TAX_CERTIFICATE) before submission. */
export class SubmitCompanyVerificationUseCase {
  constructor(
    private readonly verifications: CompanyVerificationRepository,
    private readonly memberships: CompanyMembershipRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator,
  ) {}

  async execute(userId: string, companyId: string): Promise<CompanyVerificationRecord> {
    const actor = await resolveCompanyActor(userId, companyId, this.memberships);
    if (!canManageCompanyProfile(actor.role)) {
      throw new UnauthorizedError("Only a company owner or admin may submit a verification request.");
    }

    const verification = await this.verifications.findActiveByCompanyProfileId(companyId);
    if (!verification) {
      throw new NotFoundError("CompanyVerification", companyId);
    }

    if (!canSubmit(verification.status) || !canTransition(verification.status, "PENDING")) {
      throw new ConflictError("This verification request cannot be submitted in its current state.");
    }

    const documents = await this.verifications.listDocuments(verification.id);
    if (!hasRequiredDocuments(documents.map((d) => d.type))) {
      throw new ValidationError("Upload at least one business registration document before submitting for review.");
    }

    const updated = await this.verifications.updateStatus(verification.id, {
      status: "PENDING",
      submittedAt: new Date(),
    });

    await this.auditLog.record({
      adminUserId: userId,
      action: "COMPANY_VERIFICATION_SUBMITTED",
      targetType: "CompanyVerification",
      targetId: verification.id,
      metadata: { companyId, documentCount: documents.length },
    });

    try {
      await this.notifications.notify({
        userId,
        type: "COMPANY_VERIFICATION_SUBMITTED",
        title: "Verification request submitted",
        message: "We have received your company's verification request and will review it shortly.",
        resourceType: "COMPANY_VERIFICATION",
        resourceId: verification.id,
        actionUrl: "/dashboard/company/verification",
      });
    } catch (error) {
      console.error("Failed to create company-verification-submitted notification", error);
    }

    return updated;
  }
}
