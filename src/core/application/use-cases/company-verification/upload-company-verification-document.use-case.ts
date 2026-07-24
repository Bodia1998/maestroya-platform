import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import type { CompanyVerificationDocumentRecord, CompanyVerificationRepository } from "@/domain/repositories/company-verification-repository";
import { canManageCompanyProfile } from "@/domain/services/company-membership-rules";
import { canModifyDocuments, MAX_DOCUMENTS_PER_VERIFICATION } from "@/domain/services/company-verification-rules";
import type { CompanyVerificationDocumentTypeValue } from "@/domain/services/company-verification-rules";
import type { CompanyVerificationDocumentUploadService } from "@/application/interfaces/company-verification-document-upload-service";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

export interface UploadCompanyVerificationDocumentInput {
  type: CompanyVerificationDocumentTypeValue;
  fileBuffer: Buffer;
  contentType: string;
  originalFilename: string;
  fileSizeBytes: number;
}

/** Module 18 — Company Professional: uploads a document to the company's
 *  active verification case. OWNER/ADMIN only; only while DRAFT or
 *  RESUBMISSION_REQUIRED (canModifyDocuments) — mirrors
 *  UploadVerificationDocumentUseCase (Module 17). */
export class UploadCompanyVerificationDocumentUseCase {
  constructor(
    private readonly verifications: CompanyVerificationRepository,
    private readonly memberships: CompanyMembershipRepository,
    private readonly uploads: CompanyVerificationDocumentUploadService,
    private readonly auditLog: AdminAuditLogRepository,
  ) {}

  async execute(
    userId: string,
    companyId: string,
    input: UploadCompanyVerificationDocumentInput,
  ): Promise<CompanyVerificationDocumentRecord> {
    const actor = await resolveCompanyActor(userId, companyId, this.memberships);
    if (!canManageCompanyProfile(actor.role)) {
      throw new UnauthorizedError("Only a company owner or admin may manage verification documents.");
    }

    const verification = await this.verifications.findActiveByCompanyProfileId(companyId);
    if (!verification) {
      throw new NotFoundError("CompanyVerification", companyId);
    }

    if (!canModifyDocuments(verification.status)) {
      throw new ConflictError("Documents can only be added before submission or when a resubmission is requested.");
    }

    const existingCount = await this.verifications.countDocuments(verification.id);
    if (existingCount >= MAX_DOCUMENTS_PER_VERIFICATION) {
      throw new ValidationError(`A verification request can hold at most ${MAX_DOCUMENTS_PER_VERIFICATION} documents.`);
    }

    const fileUrl = await this.uploads.uploadCompanyVerificationDocument(
      verification.id,
      input.fileBuffer,
      input.contentType,
    );

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
      action: "COMPANY_VERIFICATION_DOCUMENT_UPLOADED",
      targetType: "CompanyVerification",
      targetId: verification.id,
      metadata: { documentId: document.id, documentType: document.type },
    });

    return document;
  }
}
