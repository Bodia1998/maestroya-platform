import { ConflictError, NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import type { CompanyVerificationRepository } from "@/domain/repositories/company-verification-repository";
import { canManageCompanyProfile } from "@/domain/services/company-membership-rules";
import { canModifyDocuments } from "@/domain/services/company-verification-rules";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

/** Module 18 — Company Professional: removes a document from the company's
 *  own active case (hard delete — mirrors RemoveVerificationDocumentUseCase).
 *  A document belonging to a different company's case is rejected as
 *  NotFoundError, never a distinguishable "exists but isn't yours". */
export class RemoveCompanyVerificationDocumentUseCase {
  constructor(
    private readonly verifications: CompanyVerificationRepository,
    private readonly memberships: CompanyMembershipRepository,
    private readonly auditLog: AdminAuditLogRepository,
  ) {}

  async execute(userId: string, companyId: string, documentId: string): Promise<void> {
    const actor = await resolveCompanyActor(userId, companyId, this.memberships);
    if (!canManageCompanyProfile(actor.role)) {
      throw new UnauthorizedError("Only a company owner or admin may manage verification documents.");
    }

    const verification = await this.verifications.findActiveByCompanyProfileId(companyId);
    if (!verification) {
      throw new NotFoundError("CompanyVerification", companyId);
    }

    const document = await this.verifications.findDocumentById(documentId);
    if (!document || document.verificationId !== verification.id) {
      throw new NotFoundError("CompanyVerificationDocument", documentId);
    }

    if (!canModifyDocuments(verification.status)) {
      throw new ConflictError("Documents can only be removed before submission or when a resubmission is requested.");
    }

    await this.verifications.removeDocument(documentId);

    await this.auditLog.record({
      adminUserId: userId,
      action: "COMPANY_VERIFICATION_DOCUMENT_REMOVED",
      targetType: "CompanyVerification",
      targetId: verification.id,
      metadata: { documentId },
    });
  }
}
