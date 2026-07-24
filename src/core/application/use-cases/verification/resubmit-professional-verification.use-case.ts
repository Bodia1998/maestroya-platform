import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type {
  ProfessionalVerificationRecord,
  ProfessionalVerificationRepository,
} from "@/domain/repositories/professional-verification-repository";
import { canResubmit, canTransition, hasRequiredDocuments } from "@/domain/services/professional-verification-rules";
import type { NotificationCreator } from "@/application/ports/notification-creator";

/**
 * Professional Verification module (Module 17): re-submits a case an admin
 * asked the professional to fix (RESUBMISSION_REQUIRED) or that was
 * previously REJECTED, moving it back to PENDING for another review round.
 * Same ownership/required-document guarantees as the first submission. Clears
 * the previous resubmission instructions and sets the public trust signal
 * back to PENDING.
 */
export class ResubmitProfessionalVerificationUseCase {
  constructor(
    private readonly verifications: ProfessionalVerificationRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator,
  ) {}

  async execute(userId: string): Promise<ProfessionalVerificationRecord> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional || professional.status !== "ACTIVE") {
      throw new ValidationError("You must have an active professional profile to resubmit a verification request.");
    }

    const verification = await this.verifications.findActiveByProfessionalProfileId(professional.id);
    if (!verification) {
      throw new NotFoundError("ProfessionalVerification", professional.id);
    }

    if (!canResubmit(verification.status) || !canTransition(verification.status, "PENDING")) {
      throw new ConflictError("This verification request cannot be resubmitted in its current state.");
    }

    const documents = await this.verifications.listDocuments(verification.id);
    if (!hasRequiredDocuments(documents.map((d) => d.type))) {
      throw new ValidationError("Upload at least one identity document before resubmitting for review.");
    }

    const updated = await this.verifications.updateStatus(verification.id, {
      status: "PENDING",
      submittedAt: new Date(),
      // A fresh review round starts clean.
      resubmissionReason: null,
      rejectionReason: null,
    });

    await this.verifications.setProfileVerificationStatus(professional.id, "PENDING", null);

    await this.auditLog.record({
      adminUserId: userId,
      action: "VERIFICATION_RESUBMITTED",
      targetType: "ProfessionalVerification",
      targetId: verification.id,
      metadata: { documentCount: documents.length },
    });

    try {
      await this.notifications.notify({
        userId,
        type: "VERIFICATION_SUBMITTED",
        title: "Verification request resubmitted",
        message: "We have received your updated verification request and will review it shortly.",
        resourceType: "PROFESSIONAL_VERIFICATION",
        resourceId: verification.id,
        actionUrl: "/dashboard/professional/verification",
      });
    } catch (error) {
      console.error("Failed to create verification-resubmitted notification", error);
    }

    return updated;
  }
}
