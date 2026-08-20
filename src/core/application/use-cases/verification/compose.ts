import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PrismaExternalWebhookEventRepository } from "@/infrastructure/database/prisma/repositories/prisma-external-webhook-event-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaProfessionalVerificationRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-verification-repository";
// Module 75 — Company Payout Eligibility.
import { PrismaCompanyVerificationRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-verification-repository";
import { PrismaCompanyRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-repository";
import { PrismaCompanyPayoutAccountRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-payout-account-repository";
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
// Module 59 — Professional Verification (Persona).
import { CheckPayoutEligibilityUseCase } from "@/application/use-cases/verification/check-payout-eligibility.use-case";
import { ProcessPersonaWebhookUseCase } from "@/application/use-cases/verification/process-persona-webhook.use-case";
import { RefreshVerificationStatusUseCase } from "@/application/use-cases/verification/refresh-verification-status.use-case";
import { StartProfessionalVerificationUseCase } from "@/application/use-cases/verification/start-professional-verification.use-case";
import { SynchronizeVerificationUseCase } from "@/application/use-cases/verification/synchronize-verification.use-case";
import { createVerificationProvider } from "@/infrastructure/verification/verification-provider-factory";

/**
 * Professional Verification module (Module 17): composition root — wires the
 * Prisma implementations, the Cloudinary upload service, the shared audit-log
 * repository and the notification port to every verification use case. Same
 * "one shared repository instance, one factory function per use case"
 * convention as admin/compose.ts and notification/compose.ts. Never
 * instantiated directly from a Server Action.
 */

const verifications = new PrismaProfessionalVerificationRepository();
// Module 75 — Company Payout Eligibility.
const companyVerifications = new PrismaCompanyVerificationRepository();
const companies = new PrismaCompanyRepository();
const companyPayoutAccounts = new PrismaCompanyPayoutAccountRepository();
const professionals = new PrismaProfessionalRepository();
const auditLog = new PrismaAdminAuditLogRepository();
const uploads = new CloudinaryVerificationDocumentUploadService();
// Module 70.1 — Pre-Stripe Security & Integration Hardening: the
// provider-independent external-event idempotency ledger — see
// ExternalWebhookEventRepository's own doc comment.
const webhookEvents = new PrismaExternalWebhookEventRepository();
// Module 39 — Sentry + CI/CD Hardening: SentryFailureReporter in
// production, ConsoleFailureReporter (Module 37) otherwise — see
// failure-reporter-factory.ts's own doc comment. No use case or
// subscriber in this module changes.
const failureReporter = createFailureReporter();
// Module 59 — Professional Verification (Persona): `NullVerificationProvider`
// (VERIFICATION_PROVIDER unset/"manual") or `PersonaVerificationProvider` —
// see verification-provider-factory.ts's own doc comment for the
// fallback rule. The manual use cases above never depend on this.
const verificationProvider = createVerificationProvider();

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

// --- Module 59 — Professional Verification (Persona) ---

export function makeStartProfessionalVerificationUseCase() {
  return new StartProfessionalVerificationUseCase(verifications, professionals, verificationProvider, eventBus, failureReporter);
}

export function makeRefreshVerificationStatusUseCase() {
  return new RefreshVerificationStatusUseCase(verifications, professionals, verificationProvider, auditLog);
}

export function makeSynchronizeVerificationUseCase() {
  return new SynchronizeVerificationUseCase(verifications, makeRefreshVerificationStatusUseCase());
}

export function makeCheckPayoutEligibilityUseCase() {
  // Module 75 — Company Payout Eligibility: this instance is wired with
  // company support too, so any caller in THIS module that also needs
  // executeForCompany can use it — mirrors job/compose.ts's own instance.
  return new CheckPayoutEligibilityUseCase(verifications, companyVerifications, companies, companyPayoutAccounts);
}

/** The provider name the current process is wired to (`"MANUAL"` or
 *  `"PERSONA"`) — lets a caller (e.g. a dashboard) decide whether to offer
 *  the automated-check button without importing the factory/env directly. */
export function getVerificationProviderName() {
  return verificationProvider.name;
}

/**
 * Module 70.1 — Pre-Stripe Security & Integration Hardening: the same
 * process-wide `VerificationProvider` instance every other use case in
 * this file is wired to — exposed directly (not just its `.name`) so
 * `/api/webhooks/persona/route.ts` can call `webhookValidation` on the
 * real, correctly-configured provider (Persona in production, the
 * always-invalid `NullVerificationProvider` otherwise) without
 * constructing a second one or importing the factory/env directly. Thin
 * Route Handler rule: this is the only verification-related dependency
 * that route needs from this module.
 */
export function getVerificationProviderInstance() {
  return verificationProvider;
}

export function makeProcessPersonaWebhookUseCase() {
  return new ProcessPersonaWebhookUseCase(verifications, webhookEvents, makeRefreshVerificationStatusUseCase());
}
