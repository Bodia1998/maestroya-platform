import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type {
  ProfessionalVerificationRecord,
  ProfessionalVerificationRepository,
} from "@/domain/repositories/professional-verification-repository";
import { canSubmit, canTransition, hasRequiredDocuments } from "@/domain/services/professional-verification-rules";
import type { NotificationCreator } from "@/application/ports/notification-creator";

/**
 * Professional Verification module (Module 17): submits the authenticated
 * professional's DRAFT case into the admin review queue (DRAFT → PENDING).
 * Enforces server-side that (1) the caller owns the case, (2) it is actually
 * in DRAFT, and (3) at least one proof-of-identity document is present. Sets
 * the professional's public trust signal to PENDING, records an audit entry,
 * and best-effort notifies the professional that their request was received.
 */
export class SubmitProfessionalVerificationUseCase {
  constructor(
    private readonly verifications: ProfessionalVerificationRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator,
  ) {}

  async execute(userId: string): Promise<ProfessionalVerificationRecord> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional || professional.status !== "ACTIVE") {
      throw new ValidationError("You must have an active professional profile to submit a verification request.");
    }

    const verification = await this.verifications.findActiveByProfessionalProfileId(professional.id);
    if (!verification) {
      throw new NotFoundError("ProfessionalVerification", professional.id);
    }

    if (!canSubmit(verification.status) || !canTransition(verification.status, "PENDING")) {
      throw new ConflictError("This verification request cannot be submitted in its current state.");
    }

    const documents = await this.verifications.listDocuments(verification.id);
    if (!hasRequiredDocuments(documents.map((d) => d.type))) {
      throw new ValidationError("Upload at least one identity document before submitting for review.");
    }

    const updated = await this.verifications.updateStatus(verification.id, {
      status: "PENDING",
      submittedAt: new Date(),
    });

    // Public trust signal: PENDING while under review.
    await this.verifications.setProfileVerificationStatus(professional.id, "PENDING", null);

    await this.auditLog.record({
      adminUserId: userId,
      action: "VERIFICATION_SUBMITTED",
      targetType: "ProfessionalVerification",
      targetId: verification.id,
      metadata: { documentCount: documents.length },
    });

    try {
      await this.notifications.notify({
        userId,
        type: "VERIFICATION_SUBMITTED",
        title: "Verification request submitted",
        message: "We have received your verification request and will review it shortly.",
        resourceType: "PROFESSIONAL_VERIFICATION",
        resourceId: verification.id,
        actionUrl: "/dashboard/professional/verification",
      });
    } catch (error) {
      console.error("Failed to create verification-submitted notification", error);
    }

    return updated;
  }
}
