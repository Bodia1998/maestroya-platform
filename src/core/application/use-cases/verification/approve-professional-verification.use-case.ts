import { ConflictError, NotFoundError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type {
  ProfessionalVerificationRecord,
  ProfessionalVerificationRepository,
} from "@/domain/repositories/professional-verification-repository";
import { canApprove, canTransition, computeExpiresAt } from "@/domain/services/professional-verification-rules";
import type { NotificationCreator } from "@/application/ports/notification-creator";

/**
 * Professional Verification module (Module 17): an admin approves a case
 * (PENDING/UNDER_REVIEW → APPROVED). Sets the reviewer, review timestamp and
 * an expiry, flips the professional's public trust signal to VERIFIED (with
 * `verifiedAt`), records an audit entry, and best-effort notifies the
 * professional. The recipient is resolved server-side from the case's own
 * professional, never from client input.
 */
export class ApproveProfessionalVerificationUseCase {
  constructor(
    private readonly verifications: ProfessionalVerificationRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator,
  ) {}

  async execute(adminUserId: string, verificationId: string): Promise<ProfessionalVerificationRecord> {
    const verification = await this.verifications.findById(verificationId);
    if (!verification) {
      throw new NotFoundError("ProfessionalVerification", verificationId);
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

    await this.verifications.setProfileVerificationStatus(verification.professionalProfileId, "VERIFIED", now);

    await this.auditLog.record({
      adminUserId,
      action: "VERIFICATION_APPROVED",
      targetType: "ProfessionalVerification",
      targetId: verificationId,
      metadata: { professionalProfileId: verification.professionalProfileId },
    });

    const professional = await this.professionals.findById(verification.professionalProfileId);
    if (professional) {
      try {
        await this.notifications.notify({
          userId: professional.userId,
          type: "VERIFICATION_APPROVED",
          title: "You are now a verified professional",
          message: "Your verification has been approved. A verified badge now appears on your public profile.",
          resourceType: "PROFESSIONAL_VERIFICATION",
          resourceId: verificationId,
          actionUrl: "/dashboard/professional/verification",
        });
      } catch (error) {
        console.error("Failed to create verification-approved notification", error);
      }
    }

    return updated;
  }
}
