import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type {
  ProfessionalVerificationRecord,
  ProfessionalVerificationRepository,
} from "@/domain/repositories/professional-verification-repository";
import { canReject, canTransition, isValidReviewReason } from "@/domain/services/professional-verification-rules";
import type { NotificationCreator } from "@/application/ports/notification-creator";

/**
 * Professional Verification module (Module 17): an admin rejects a case
 * (PENDING/UNDER_REVIEW → REJECTED). A reason is REQUIRED (enforced here in
 * the use case, not just at the DTO boundary) and is surfaced to the
 * professional so they know why. Sets the public trust signal to REJECTED,
 * audits, and notifies. The professional may later resubmit (REJECTED →
 * PENDING) — this is not the end of the case.
 */
export class RejectProfessionalVerificationUseCase {
  constructor(
    private readonly verifications: ProfessionalVerificationRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator,
  ) {}

  async execute(adminUserId: string, verificationId: string, reason: string): Promise<ProfessionalVerificationRecord> {
    if (!isValidReviewReason(reason)) {
      throw new ValidationError("A rejection reason is required.");
    }

    const verification = await this.verifications.findById(verificationId);
    if (!verification) {
      throw new NotFoundError("ProfessionalVerification", verificationId);
    }

    if (!canReject(verification.status) || !canTransition(verification.status, "REJECTED")) {
      throw new ConflictError("This verification request cannot be rejected in its current state.");
    }

    const now = new Date();
    const updated = await this.verifications.updateStatus(verificationId, {
      status: "REJECTED",
      reviewedByUserId: adminUserId,
      reviewedAt: now,
      rejectionReason: reason.trim(),
    });

    await this.verifications.setProfileVerificationStatus(verification.professionalProfileId, "REJECTED", null);

    await this.auditLog.record({
      adminUserId,
      action: "VERIFICATION_REJECTED",
      targetType: "ProfessionalVerification",
      targetId: verificationId,
      // The reason itself is stored on the case; the audit records that a
      // rejection happened without duplicating potentially-sensitive prose.
      metadata: { professionalProfileId: verification.professionalProfileId },
    });

    const professional = await this.professionals.findById(verification.professionalProfileId);
    if (professional) {
      try {
        await this.notifications.notify({
          userId: professional.userId,
          type: "VERIFICATION_REJECTED",
          title: "Verification request rejected",
          message: "Your verification request was rejected. Open your verification page to see why and try again.",
          resourceType: "PROFESSIONAL_VERIFICATION",
          resourceId: verificationId,
          actionUrl: "/dashboard/professional/verification",
        });
      } catch (error) {
        console.error("Failed to create verification-rejected notification", error);
      }
    }

    return updated;
  }
}
