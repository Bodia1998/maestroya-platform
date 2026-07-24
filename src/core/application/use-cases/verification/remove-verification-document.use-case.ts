import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ProfessionalVerificationRepository } from "@/domain/repositories/professional-verification-repository";
import { canModifyDocuments } from "@/domain/services/professional-verification-rules";

/**
 * Professional Verification module (Module 17): removes a document from the
 * authenticated professional's current verification case. Ownership is
 * enforced in depth: the document's parent case must belong to the caller's
 * own ProfessionalProfile (resolved from the session), so professional A can
 * never delete professional B's document even with a valid documentId.
 *
 * Only allowed while the case is DRAFT or RESUBMISSION_REQUIRED — the
 * document set is frozen once the case is in the review pipeline.
 */
export class RemoveVerificationDocumentUseCase {
  constructor(
    private readonly verifications: ProfessionalVerificationRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly auditLog: AdminAuditLogRepository,
  ) {}

  async execute(userId: string, documentId: string): Promise<void> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional || professional.status !== "ACTIVE") {
      throw new ValidationError("You must have an active professional profile to manage verification documents.");
    }

    const document = await this.verifications.findDocumentById(documentId);
    if (!document) {
      throw new NotFoundError("VerificationDocument", documentId);
    }

    const verification = await this.verifications.findById(document.verificationId);
    // Cross-professional access denial: the case must be the caller's own.
    if (!verification || verification.professionalProfileId !== professional.id) {
      throw new NotFoundError("VerificationDocument", documentId);
    }

    if (!canModifyDocuments(verification.status)) {
      throw new ConflictError("Documents can only be removed before submission or when a resubmission is requested.");
    }

    await this.verifications.removeDocument(documentId);

    await this.auditLog.record({
      adminUserId: userId,
      action: "VERIFICATION_DOCUMENT_REMOVED",
      targetType: "ProfessionalVerification",
      targetId: verification.id,
      metadata: { documentId, documentType: document.type },
    });
  }
}
