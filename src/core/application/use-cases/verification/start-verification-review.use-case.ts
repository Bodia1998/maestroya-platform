import { ConflictError, NotFoundError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type {
  ProfessionalVerificationRecord,
  ProfessionalVerificationRepository,
} from "@/domain/repositories/professional-verification-repository";
import { canStartReview, canTransition } from "@/domain/services/professional-verification-rules";

/**
 * Professional Verification module (Module 17): an admin picks up a queued
 * (PENDING) case for review (PENDING → UNDER_REVIEW) and is recorded as its
 * reviewer. `adminUserId` is always the session-derived admin id (never
 * client input) — see the Server Action's requireRole() guard.
 */
export class StartVerificationReviewUseCase {
  constructor(
    private readonly verifications: ProfessionalVerificationRepository,
    private readonly auditLog: AdminAuditLogRepository,
  ) {}

  async execute(adminUserId: string, verificationId: string): Promise<ProfessionalVerificationRecord> {
    const verification = await this.verifications.findById(verificationId);
    if (!verification) {
      throw new NotFoundError("ProfessionalVerification", verificationId);
    }

    if (!canStartReview(verification.status) || !canTransition(verification.status, "UNDER_REVIEW")) {
      throw new ConflictError("Only a pending verification request can be moved to review.");
    }

    const updated = await this.verifications.updateStatus(verificationId, {
      status: "UNDER_REVIEW",
      reviewedByUserId: adminUserId,
    });

    await this.auditLog.record({
      adminUserId,
      action: "VERIFICATION_REVIEW_STARTED",
      targetType: "ProfessionalVerification",
      targetId: verificationId,
      metadata: { professionalProfileId: verification.professionalProfileId },
    });

    return updated;
  }
}
