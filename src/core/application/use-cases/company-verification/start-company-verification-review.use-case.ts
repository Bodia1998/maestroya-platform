import { ConflictError, NotFoundError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CompanyVerificationRecord, CompanyVerificationRepository } from "@/domain/repositories/company-verification-repository";
import { canStartReview, canTransition } from "@/domain/services/company-verification-rules";

/** Module 18 — Company Professional: an ADMIN/SUPER_ADMIN moves a case from
 *  the queue into active review (PENDING → UNDER_REVIEW). Mirrors
 *  StartVerificationReviewUseCase. Caller authorization (`requireRole`) is
 *  enforced at the Server Action boundary, not here — same convention as
 *  every other admin use case in this codebase. */
export class StartCompanyVerificationReviewUseCase {
  constructor(
    private readonly verifications: CompanyVerificationRepository,
    private readonly auditLog: AdminAuditLogRepository,
  ) {}

  async execute(adminUserId: string, verificationId: string): Promise<CompanyVerificationRecord> {
    const verification = await this.verifications.findById(verificationId);
    if (!verification) {
      throw new NotFoundError("CompanyVerification", verificationId);
    }

    if (!canStartReview(verification.status) || !canTransition(verification.status, "UNDER_REVIEW")) {
      throw new ConflictError("This verification request cannot be reviewed in its current state.");
    }

    const updated = await this.verifications.updateStatus(verificationId, { status: "UNDER_REVIEW" });

    await this.auditLog.record({
      adminUserId,
      action: "COMPANY_VERIFICATION_REVIEW_STARTED",
      targetType: "CompanyVerification",
      targetId: verificationId,
      metadata: { companyProfileId: verification.companyProfileId },
    });

    return updated;
  }
}
