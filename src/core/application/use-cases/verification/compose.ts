import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaProfessionalVerificationRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-verification-repository";
import { CloudinaryVerificationDocumentUploadService } from "@/infrastructure/storage/cloudinary/verification-document-upload-service";
import { createFailureReporter } from "@/infrastructure/observability/failure-reporter-factory";
import { eventBus } from "@/infrastructure/events/compose";
// Side-effect import: registers NotifyProfessionalVerificationStatusChangeSubscriber
// against the shared eventBus. Mirrors admin/compose.ts's own identical
// import of notification/compose.ts — see that file's doc comment for why
// this is imported here rather than relying solely on instrumentation.ts.
import "@/application/use-cases/notification/compose";
import { ProfessionalVerificationStatusChanged } from "@/domain/events/professional-verification-status-changed";
import { RecordProfessionalVerificationAuditLogSubscriber } from "@/application/use-cases/verification/record-professional-verification-audit-log.subscriber";
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
// Module 39 — Sentry + CI/CD Hardening: SentryFailureReporter in
// production, ConsoleFailureReporter (Module 37) otherwise — see
// failure-reporter-factory.ts's own doc comment. No use case or
// subscriber in this module changes.
const failureReporter = createFailureReporter();

/**
 * Module 37 — Domain Event Subscribers: registers this module's
 * `ProfessionalVerificationStatusChanged` audit-log subscriber against the
 * shared `eventBus`, at module load time — the exact pattern documented in
 * `infrastructure/events/compose.ts`'s own doc comment and mirrored from
 * `admin/compose.ts`. The sibling notification subscriber is registered
 * the same way from `notification/compose.ts`; neither file imports the
 * other's use cases.
 */
eventBus.subscribe(
  ProfessionalVerificationStatusChanged,
  new RecordProfessionalVerificationAuditLogSubscriber(auditLog),
);

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
  return new SubmitProfessionalVerificationUseCase(verifications, professionals, eventBus, failureReporter);
}

export function makeResubmitProfessionalVerificationUseCase() {
  return new ResubmitProfessionalVerificationUseCase(verifications, professionals, eventBus, failureReporter);
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
  return new ApproveProfessionalVerificationUseCase(verifications, professionals, eventBus, failureReporter);
}

export function makeRejectProfessionalVerificationUseCase() {
  return new RejectProfessionalVerificationUseCase(verifications, professionals, eventBus, failureReporter);
}

export function makeRequestVerificationResubmissionUseCase() {
  return new RequestVerificationResubmissionUseCase(verifications, professionals, eventBus, failureReporter);
}
