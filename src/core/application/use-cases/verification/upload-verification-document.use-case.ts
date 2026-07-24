import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type {
  ProfessionalVerificationRepository,
  VerificationDocumentRecord,
} from "@/domain/repositories/professional-verification-repository";
import { canModifyDocuments, MAX_DOCUMENTS_PER_VERIFICATION, type VerificationDocumentTypeValue } from "@/domain/services/professional-verification-rules";
import type { VerificationDocumentUploadService } from "@/application/interfaces/verification-document-upload-service";

export interface UploadVerificationDocumentInput {
  type: VerificationDocumentTypeValue;
  fileBuffer: Buffer;
  contentType: string;
  originalFilename: string;
  fileSizeBytes: number;
}

/**
 * Professional Verification module (Module 17): uploads a document to the
 * authenticated professional's current verification case. Ownership is
 * always re-derived from the session (`userId` → their ProfessionalProfile →
 * their active case) — a professional can never attach a document to another
 * professional's case.
 *
 * Documents may only be added while the case is DRAFT or
 * RESUBMISSION_REQUIRED (see canModifyDocuments) so a reviewer always sees
 * exactly the set that was submitted. The Cloudinary upload happens only
 * after every authorization/state check passes, so a rejected caller never
 * causes an orphaned upload.
 */
export class UploadVerificationDocumentUseCase {
  constructor(
    private readonly verifications: ProfessionalVerificationRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly uploads: VerificationDocumentUploadService,
    private readonly auditLog: AdminAuditLogRepository,
  ) {}

  async execute(userId: string, input: UploadVerificationDocumentInput): Promise<VerificationDocumentRecord> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional || professional.status !== "ACTIVE") {
      throw new ValidationError("You must have an active professional profile to manage verification documents.");
    }

    const verification = await this.verifications.findActiveByProfessionalProfileId(professional.id);
    if (!verification) {
      throw new NotFoundError("ProfessionalVerification", professional.id);
    }

    if (!canModifyDocuments(verification.status)) {
      throw new ConflictError("Documents can only be added before submission or when a resubmission is requested.");
    }

    const existingCount = await this.verifications.countDocuments(verification.id);
    if (existingCount >= MAX_DOCUMENTS_PER_VERIFICATION) {
      throw new ValidationError(`A verification request can hold at most ${MAX_DOCUMENTS_PER_VERIFICATION} documents.`);
    }

    const fileUrl = await this.uploads.uploadVerificationDocument(verification.id, input.fileBuffer, input.contentType);

    const document = await this.verifications.addDocument({
      verificationId: verification.id,
      type: input.type,
      fileUrl,
      originalFilename: input.originalFilename,
      mimeType: input.contentType,
      fileSizeBytes: input.fileSizeBytes,
    });

    await this.auditLog.record({
      adminUserId: userId,
      action: "VERIFICATION_DOCUMENT_UPLOADED",
      targetType: "ProfessionalVerification",
      targetId: verification.id,
      // Never log the file URL or bytes — only safe, non-sensitive metadata.
      metadata: { documentId: document.id, documentType: document.type },
    });

    return document;
  }
}
