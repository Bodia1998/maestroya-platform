import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type {
  ProfessionalVerificationRecord,
  ProfessionalVerificationRepository,
} from "@/domain/repositories/professional-verification-repository";
import { canRequestResubmission, canTransition, isValidReviewReason } from "@/domain/services/professional-verification-rules";
import type { NotificationCreator } from "@/application/ports/notification-creator";

/**
 * Professional Verification module (Module 17): an admin asks the
 * professional to fix and resubmit (PENDING/UNDER_REVIEW →
 * RESUBMISSION_REQUIRED). A reason (instructions) is REQUIRED and stored on
 * the case so the professional sees exactly what to change. The public trust
 * signal stays PENDING (the professional is still mid-verification, not
 * rejected). Audits and notifies.
 */
export class RequestVerificationResubmissionUseCase {
  constructor(
    private readonly verifications: ProfessionalVerificationRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator,
  ) {}

  async execute(adminUserId: string, verificationId: string, reason: string): Promise<ProfessionalVerificationRecord> {
    if (!isValidReviewReason(reason)) {
      throw new ValidationError("A resubmission reason is required.");
    }

    const verification = await this.verifications.findById(verificationId);
    if (!verification) {
      throw new NotFoundError("ProfessionalVerification", verificationId);
    }

    if (!canRequestResubmission(verification.status) || !canTransition(verification.status, "RESUBMISSION_REQUIRED")) {
      throw new ConflictError("A resubmission can only be requested for a pending or in-review request.");
    }

    const now = new Date();
    const updated = await this.verifications.updateStatus(verificationId, {
      status: "RESUBMISSION_REQUIRED",
      reviewedByUserId: adminUserId,
      reviewedAt: now,
      resubmissionReason: reason.trim(),
    });

    // Still mid-verification — keep the public signal PENDING.
    await this.verifications.setProfileVerificationStatus(verification.professionalProfileId, "PENDING", null);

    await this.auditLog.record({
      adminUserId,
      action: "VERIFICATION_RESUBMISSION_REQUESTED",
      targetType: "ProfessionalVerification",
      targetId: verificationId,
      metadata: { professionalProfileId: verification.professionalProfileId },
    });

    const professional = await this.professionals.findById(verification.professionalProfileId);
    if (professional) {
      try {
        await this.notifications.notify({
          userId: professional.userId,
          type: "VERIFICATION_RESUBMISSION_REQUIRED",
          title: "More information needed for verification",
          message: "A reviewer has asked you to update your verification request. Open your verification page for details.",
          resourceType: "PROFESSIONAL_VERIFICATION",
          resourceId: verificationId,
          actionUrl: "/dashboard/professional/verification",
        });
      } catch (error) {
        console.error("Failed to create verification-resubmission notification", error);
      }
    }

    return updated;
  }
}
