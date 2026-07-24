import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PrismaCompanyRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-repository";
import { PrismaCompanyMembershipRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-membership-repository";
import { PrismaCompanyVerificationRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-verification-repository";
import { CloudinaryCompanyVerificationDocumentUploadService } from "@/infrastructure/storage/cloudinary/company-verification-document-upload-service";
import { NotificationServiceCreator } from "@/infrastructure/notifications/notification-service";
import { ApproveCompanyVerificationUseCase } from "@/application/use-cases/company-verification/approve-company-verification.use-case";
import { CreateCompanyVerificationUseCase } from "@/application/use-cases/company-verification/create-company-verification.use-case";
import { GetAdminCompanyVerificationUseCase } from "@/application/use-cases/company-verification/get-admin-company-verification.use-case";
import { GetCompanyVerificationUseCase } from "@/application/use-cases/company-verification/get-company-verification.use-case";
import { ListAdminCompanyVerificationsUseCase } from "@/application/use-cases/company-verification/list-admin-company-verifications.use-case";
import { RejectCompanyVerificationUseCase } from "@/application/use-cases/company-verification/reject-company-verification.use-case";
import { RemoveCompanyVerificationDocumentUseCase } from "@/application/use-cases/company-verification/remove-company-verification-document.use-case";
import { RequestCompanyVerificationResubmissionUseCase } from "@/application/use-cases/company-verification/request-company-verification-resubmission.use-case";
import { ResubmitCompanyVerificationUseCase } from "@/application/use-cases/company-verification/resubmit-company-verification.use-case";
import { StartCompanyVerificationReviewUseCase } from "@/application/use-cases/company-verification/start-company-verification-review.use-case";
import { SubmitCompanyVerificationUseCase } from "@/application/use-cases/company-verification/submit-company-verification.use-case";
import { UploadCompanyVerificationDocumentUseCase } from "@/application/use-cases/company-verification/upload-company-verification-document.use-case";

/** Module 18 — Company Professional: composition root, mirrors
 *  verification/compose.ts (Module 17) exactly. */

const verifications = new PrismaCompanyVerificationRepository();
const companies = new PrismaCompanyRepository();
const memberships = new PrismaCompanyMembershipRepository();
const auditLog = new PrismaAdminAuditLogRepository();
const uploads = new CloudinaryCompanyVerificationDocumentUploadService();
const notifications = new NotificationServiceCreator();

// --- Company side ---

export function makeGetCompanyVerificationUseCase() {
  return new GetCompanyVerificationUseCase(verifications, memberships);
}

export function makeCreateCompanyVerificationUseCase() {
  return new CreateCompanyVerificationUseCase(verifications, memberships);
}

export function makeUploadCompanyVerificationDocumentUseCase() {
  return new UploadCompanyVerificationDocumentUseCase(verifications, memberships, uploads, auditLog);
}

export function makeRemoveCompanyVerificationDocumentUseCase() {
  return new RemoveCompanyVerificationDocumentUseCase(verifications, memberships, auditLog);
}

export function makeSubmitCompanyVerificationUseCase() {
  return new SubmitCompanyVerificationUseCase(verifications, memberships, auditLog, notifications);
}

export function makeResubmitCompanyVerificationUseCase() {
  return new ResubmitCompanyVerificationUseCase(verifications, memberships, auditLog, notifications);
}

// --- Admin side ---

export function makeListAdminCompanyVerificationsUseCase() {
  return new ListAdminCompanyVerificationsUseCase(verifications);
}

export function makeGetAdminCompanyVerificationUseCase() {
  return new GetAdminCompanyVerificationUseCase(verifications);
}

export function makeStartCompanyVerificationReviewUseCase() {
  return new StartCompanyVerificationReviewUseCase(verifications, auditLog);
}

export function makeApproveCompanyVerificationUseCase() {
  return new ApproveCompanyVerificationUseCase(verifications, companies, auditLog, notifications);
}

export function makeRejectCompanyVerificationUseCase() {
  return new RejectCompanyVerificationUseCase(verifications, companies, auditLog, notifications);
}

export function makeRequestCompanyVerificationResubmissionUseCase() {
  return new RequestCompanyVerificationResubmissionUseCase(verifications, companies, auditLog, notifications);
}
