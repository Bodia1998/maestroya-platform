import { PrismaAddressRepository } from "@/infrastructure/database/prisma/repositories/prisma-address-repository";
import { PrismaAuthTokenRepository } from "@/infrastructure/database/prisma/repositories/prisma-auth-token-repository";
import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PrismaAppointmentRepository } from "@/infrastructure/database/prisma/repositories/prisma-appointment-repository";
import { PrismaCompanyInvitationRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-invitation-repository";
import { PrismaCompanyMembershipRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-membership-repository";
import { PrismaConsentRepository } from "@/infrastructure/database/prisma/repositories/prisma-consent-repository";
import { PrismaConversationRepository } from "@/infrastructure/database/prisma/repositories/prisma-conversation-repository";
import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaDisputeRepository } from "@/infrastructure/database/prisma/repositories/prisma-dispute-repository";
import { PrismaJobRepository } from "@/infrastructure/database/prisma/repositories/prisma-job-repository";
import { PrismaMessageRepository } from "@/infrastructure/database/prisma/repositories/prisma-message-repository";
import { PrismaNotificationRepository } from "@/infrastructure/database/prisma/repositories/prisma-notification-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaProfessionalVerificationRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-verification-repository";
import { PrismaQuoteRepository } from "@/infrastructure/database/prisma/repositories/prisma-quote-repository";
import { PrismaReviewRepository } from "@/infrastructure/database/prisma/repositories/prisma-review-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { PrismaSupportTicketRepository } from "@/infrastructure/database/prisma/repositories/prisma-support-ticket-repository";
import { PrismaUserRepository } from "@/infrastructure/database/prisma/repositories/prisma-user-repository";
import { CloudinaryVerificationDocumentDeletionService } from "@/infrastructure/storage/cloudinary/verification-document-deletion-service";
import { createFailureReporter } from "@/infrastructure/observability/failure-reporter-factory";
import { eventBus } from "@/infrastructure/events/compose";
import { PersonalDataExportRequested } from "@/domain/events/personal-data-export-requested";
import { PersonalDataExportPrepared } from "@/domain/events/personal-data-export-prepared";
import { AccountDeletionRequested } from "@/domain/events/account-deletion-requested";
import { AccountErasureExecuted } from "@/domain/events/account-erasure-executed";
import { ConsentGranted } from "@/domain/events/consent-granted";
import { ConsentWithdrawn } from "@/domain/events/consent-withdrawn";
import { RecordPersonalDataExportRequestedAuditLogSubscriber } from "@/application/use-cases/gdpr/record-personal-data-export-requested-audit-log.subscriber";
import { RecordPersonalDataExportPreparedAuditLogSubscriber } from "@/application/use-cases/gdpr/record-personal-data-export-prepared-audit-log.subscriber";
import { RecordAccountDeletionRequestedAuditLogSubscriber } from "@/application/use-cases/gdpr/record-account-deletion-requested-audit-log.subscriber";
import { RecordAccountErasureExecutedAuditLogSubscriber } from "@/application/use-cases/gdpr/record-account-erasure-executed-audit-log.subscriber";
import { RecordConsentGrantedAuditLogSubscriber } from "@/application/use-cases/gdpr/record-consent-granted-audit-log.subscriber";
import { RecordConsentWithdrawnAuditLogSubscriber } from "@/application/use-cases/gdpr/record-consent-withdrawn-audit-log.subscriber";
import { ExportPersonalDataUseCase } from "@/application/use-cases/gdpr/export-personal-data.use-case";
import { PrepareAccountDeletionUseCase } from "@/application/use-cases/gdpr/prepare-account-deletion.use-case";
import { ExecuteAccountErasureUseCase, type GdprErasureRepos } from "@/application/use-cases/gdpr/execute-account-erasure.use-case";
import { RetryPendingCloudinaryPurgesUseCase } from "@/application/use-cases/gdpr/retry-pending-cloudinary-purges.use-case";
import { createDistributedLock } from "@/infrastructure/locking/lock-service-factory";
import { env } from "@/infrastructure/config/env";
import { GrantConsentUseCase } from "@/application/use-cases/gdpr/grant-consent.use-case";
import { WithdrawConsentUseCase } from "@/application/use-cases/gdpr/withdraw-consent.use-case";
import type { GdprInventoryRepos } from "@/application/use-cases/gdpr/gdpr-data-inventory";
import { PrismaFraudTrustSignalCheckRepository } from "@/infrastructure/database/prisma/repositories/prisma-fraud-trust-signal-check-repository";
import { PrismaMarketingAttributionRepository } from "@/infrastructure/database/prisma/repositories/prisma-marketing-attribution-repository";
import { PrismaPartnerRepository } from "@/infrastructure/database/prisma/repositories/prisma-partner-repository";
import { PrismaReferralCodeRepository } from "@/infrastructure/database/prisma/repositories/prisma-referral-code-repository";
import { PrismaAffiliateCommissionRepository } from "@/infrastructure/database/prisma/repositories/prisma-affiliate-commission-repository";

const users = new PrismaUserRepository();
const customerProfiles = new PrismaCustomerProfileRepository();
const professionals = new PrismaProfessionalRepository();
const addresses = new PrismaAddressRepository();
const companyMembers = new PrismaCompanyMembershipRepository();
const companyInvitations = new PrismaCompanyInvitationRepository();
const serviceRequests = new PrismaServiceRequestRepository();
const quotes = new PrismaQuoteRepository();
const jobs = new PrismaJobRepository();
const appointments = new PrismaAppointmentRepository();
const conversations = new PrismaConversationRepository();
const messages = new PrismaMessageRepository();
const notifications = new PrismaNotificationRepository();
const reviews = new PrismaReviewRepository();
const supportTickets = new PrismaSupportTicketRepository();
const disputes = new PrismaDisputeRepository();
const professionalVerifications = new PrismaProfessionalVerificationRepository();
const consents = new PrismaConsentRepository();
const auditLog = new PrismaAdminAuditLogRepository();
const authTokens = new PrismaAuthTokenRepository();
// Module 96 — Referral & Affiliate Production Wiring.
const referralCodes = new PrismaReferralCodeRepository();
const affiliateCommissions = new PrismaAffiliateCommissionRepository();
const marketingAttributions = new PrismaMarketingAttributionRepository();
const partners = new PrismaPartnerRepository();
const verificationDocumentStorageDeleter = new CloudinaryVerificationDocumentDeletionService();
// Module 39 — Sentry + CI/CD Hardening: SentryFailureReporter in
// production, ConsoleFailureReporter (Module 37) otherwise — see
// failure-reporter-factory.ts's own doc comment. No use case or
// subscriber in this module changes.
const failureReporter = createFailureReporter();

const inventoryRepos: GdprInventoryRepos = {
  users,
  customerProfiles,
  professionals,
  addresses,
  companyMembers,
  companyInvitations,
  serviceRequests,
  quotes,
  jobs,
  appointments,
  conversations,
  messages,
  notifications,
  reviews,
  supportTickets,
  disputes,
  professionalVerifications,
  consents,
  auditLog,
  marketingAttributions,
  partners,
  referralCodes,
  affiliateCommissions,
};

/**
 * Module 38 — GDPR Compliance: registers this module's five audit-log
 * subscribers against the shared `eventBus`, at module load time — same
 * pattern as `dispute/compose.ts`/`verification/compose.ts` (see either
 * file's own doc comment).
 */
eventBus.subscribe(PersonalDataExportRequested, new RecordPersonalDataExportRequestedAuditLogSubscriber(auditLog));
eventBus.subscribe(PersonalDataExportPrepared, new RecordPersonalDataExportPreparedAuditLogSubscriber(auditLog));
eventBus.subscribe(AccountDeletionRequested, new RecordAccountDeletionRequestedAuditLogSubscriber(auditLog));
eventBus.subscribe(AccountErasureExecuted, new RecordAccountErasureExecutedAuditLogSubscriber(auditLog));
eventBus.subscribe(ConsentGranted, new RecordConsentGrantedAuditLogSubscriber(auditLog));
eventBus.subscribe(ConsentWithdrawn, new RecordConsentWithdrawnAuditLogSubscriber(auditLog));

export function makeExportPersonalDataUseCase() {
  return new ExportPersonalDataUseCase(inventoryRepos, eventBus, failureReporter);
}

export function makePrepareAccountDeletionUseCase() {
  return new PrepareAccountDeletionUseCase(inventoryRepos, eventBus, failureReporter);
}

const fraudTrustSignalChecks = new PrismaFraudTrustSignalCheckRepository();

const erasureRepos: GdprErasureRepos = {
  users,
  addresses,
  customerProfiles,
  professionals,
  notifications,
  professionalVerifications,
  authTokens,
  fraudTrustSignalChecks,
  marketingAttributions,
  partners,
};

// Module 94 — GDPR Cloudinary Purge Retry & Durable Erasure Completion:
// one shared retry-policy config, `env`-derived, used identically by the
// inline first attempt (`ExecuteAccountErasureUseCase`) and every
// subsequent scheduled attempt (`RetryPendingCloudinaryPurgesUseCase`) —
// so "attempt 1" always means the same thing regardless of which of the
// two call sites made it.
const cloudinaryPurgeRetryConfig = {
  maxAttempts: env.GDPR_CLOUDINARY_PURGE_MAX_ATTEMPTS,
  baseDelayMs: env.GDPR_CLOUDINARY_PURGE_BASE_DELAY_SECONDS * 1000,
};

export function makeExecuteAccountErasureUseCase() {
  return new ExecuteAccountErasureUseCase(
    erasureRepos,
    verificationDocumentStorageDeleter,
    eventBus,
    failureReporter,
    cloudinaryPurgeRetryConfig,
  );
}

/**
 * Module 94 — the scheduled retry use case
 * `api/cron/gdpr-cloudinary-purge/route.ts` calls. Reuses
 * `createDistributedLock()` — the same Module 44 lock factory
 * `reconciliation/compose.ts` already uses for
 * `RunScheduledReconciliationSweepUseCase` — no second locking
 * mechanism (module brief rule 8: "Inspect existing distributed locking
 * infrastructure. Reuse it if appropriate").
 */
export function makeRetryPendingCloudinaryPurgesUseCase() {
  return new RetryPendingCloudinaryPurgesUseCase(
    professionalVerifications,
    verificationDocumentStorageDeleter,
    cloudinaryPurgeRetryConfig,
    createDistributedLock(),
    failureReporter,
  );
}

export function makeGrantConsentUseCase() {
  return new GrantConsentUseCase(consents, eventBus, failureReporter);
}

export function makeWithdrawConsentUseCase() {
  return new WithdrawConsentUseCase(consents, eventBus, failureReporter);
}
