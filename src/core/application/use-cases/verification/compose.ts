import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaProfessionalVerificationRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-verification-repository";
import { CloudinaryVerificationDocumentUploadService } from "@/infrastructure/storage/cloudinary/verification-document-upload-service";
import { NotificationServiceCreator } from "@/infrastructure/notifications/notification-service";
import { ApproveProfessionalVerificationUseCase } from "@/application/use-cases/verification/approve-professional-verification.use-case";
import { CreateProfessionalVerificationUseCase } from "@/application/use-cases/verification/create-professional-verification.use-case";
import { GetAdminVerificationUseCase } from "@/application/use-cases/verification/get-admin-verification.use-case";
import { GetProfessionalVerificationUseCase } from "@/application/use-cases/verification/get-professional-verification.use-case";
import { ListAdminVerificationsUseCase } from "@/application/use-cases/verification/list-admin-verifications.use-case";
import { RejectProfessionalVerificationUseCase } from "@/application/use-cases/verification/reject-professional-verification.use-case";
import { RemoveVerificationDocumentUseCase } from "@/application/use-cases/verification/remove-verification-document.use-case";
import { RequestVerificationResubmissionUseCase } from "@/application/use-cases/verification/request-verification-resubmission.use-case";
import { ResubmitProfessionalVerificationUseCase } from "@/application/use-cases/verification/resubmit-professional-verification.use-case";
import { StartVerificationReviewUseCase } from "@/application/use-cases/verification/start-verification-review.use-case";
import { SubmitProfessionalVerificationUseCase } from "@/application/use-cases/verification/submit-professional-verification.use-case";
import { UploadVerificationDocumentUseCase } from "@/application/use-cases/verification/upload-verification-document.use-case";

/**
 * Professional Verification module (Module 17): composition root — wires the
 * Prisma implementations, the Cloudinary upload service, the shared audit-log
 * repository and the notification port to every verification use case. Same
 * "one shared repository instance, one factory function per use case"
 * convention as admin/compose.ts and notification/compose.ts. Never
 * instantiated directly from a Server Action.
 */

const verifications = new PrismaProfessionalVerificationRepository();
const professionals = new PrismaProfessionalRepository();
const auditLog = new PrismaAdminAuditLogRepository();
const uploads = new CloudinaryVerificationDocumentUploadService();
const notifications = new NotificationServiceCreator();

// --- Professional side ---

export function makeGetProfessionalVerificationUseCase() {
  return new GetProfessionalVerificationUseCase(verifications, professionals);
}

export function makeCreateProfessionalVerificationUseCase() {
  return new CreateProfessionalVerificationUseCase(verifications, professionals);
}

export function makeUploadVerificationDocumentUseCase() {
  return new UploadVerificationDocumentUseCase(verifications, professionals, uploads, auditLog);
}

export function makeRemoveVerificationDocumentUseCase() {
  return new RemoveVerificationDocumentUseCase(verifications, professionals, auditLog);
}

export function makeSubmitProfessionalVerificationUseCase() {
  return new SubmitProfessionalVerificationUseCase(verifications, professionals, auditLog, notifications);
}

export function makeResubmitProfessionalVerificationUseCase() {
  return new ResubmitProfessionalVerificationUseCase(verifications, professionals, auditLog, notifications);
}

// --- Admin side ---

export function makeListAdminVerificationsUseCase() {
  return new ListAdminVerificationsUseCase(verifications);
}

export function makeGetAdminVerificationUseCase() {
  return new GetAdminVerificationUseCase(verifications);
}

export function makeStartVerificationReviewUseCase() {
  return new StartVerificationReviewUseCase(verifications, auditLog);
}

export function makeApproveProfessionalVerificationUseCase() {
  return new ApproveProfessionalVerificationUseCase(verifications, professionals, auditLog, notifications);
}

export function makeRejectProfessionalVerificationUseCase() {
  return new RejectProfessionalVerificationUseCase(verifications, professionals, auditLog, notifications);
}

export function makeRequestVerificationResubmissionUseCase() {
  return new RequestVerificationResubmissionUseCase(verifications, professionals, auditLog, notifications);
}
