import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PrismaCompanyMembershipRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-membership-repository";
import { PrismaCompanyVerificationRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-verification-repository";
import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaJobRepository } from "@/infrastructure/database/prisma/repositories/prisma-job-repository";
import { PrismaJobCompletionConfirmationRepository } from "@/infrastructure/database/prisma/repositories/prisma-job-completion-confirmation-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaProfessionalVerificationRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-verification-repository";
import { PrismaQuoteRepository } from "@/infrastructure/database/prisma/repositories/prisma-quote-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { NotificationServiceCreator } from "@/infrastructure/notifications/notification-service";
import { eventBus } from "@/infrastructure/events/compose";
import { ExpireCompanyVerificationsUseCase } from "@/application/use-cases/workflow-expiration/expire-company-verifications.use-case";
import { ExpireProfessionalVerificationsUseCase } from "@/application/use-cases/workflow-expiration/expire-professional-verifications.use-case";
import { ExpireQuotesUseCase } from "@/application/use-cases/workflow-expiration/expire-quotes.use-case";
import { ExpireServiceRequestsUseCase } from "@/application/use-cases/workflow-expiration/expire-service-requests.use-case";
import { ProcessJobCompletionConfirmationsUseCase } from "@/application/use-cases/workflow-expiration/process-job-completion-confirmations.use-case";
import { RunWorkflowExpirationsUseCase } from "@/application/use-cases/workflow-expiration/run-workflow-expirations.use-case";
import { makeEvaluatePaymentReleaseUseCase } from "@/application/use-cases/job/compose";
import { makeOpenManualReviewCaseUseCase } from "@/application/use-cases/trust-integrity/compose";

const serviceRequests = new PrismaServiceRequestRepository();
const quotes = new PrismaQuoteRepository();
const professionalVerifications = new PrismaProfessionalVerificationRepository();
const companyVerifications = new PrismaCompanyVerificationRepository();
const customerProfiles = new PrismaCustomerProfileRepository();
const professionals = new PrismaProfessionalRepository();
const companyMembers = new PrismaCompanyMembershipRepository();
const auditLog = new PrismaAdminAuditLogRepository();
const notifications = new NotificationServiceCreator();

// Module 66 — Job Completion & Payment Release Protection.
const jobs = new PrismaJobRepository();
const completionConfirmations = new PrismaJobCompletionConfirmationRepository();

export function makeExpireServiceRequestsUseCase() {
  return new ExpireServiceRequestsUseCase(serviceRequests, customerProfiles, auditLog, notifications);
}

export function makeExpireQuotesUseCase() {
  return new ExpireQuotesUseCase(quotes, professionals, auditLog, notifications);
}

export function makeExpireProfessionalVerificationsUseCase() {
  return new ExpireProfessionalVerificationsUseCase(professionalVerifications, professionals, auditLog, notifications);
}

export function makeExpireCompanyVerificationsUseCase() {
  return new ExpireCompanyVerificationsUseCase(companyVerifications, companyMembers, auditLog, notifications);
}

export function makeProcessJobCompletionConfirmationsUseCase() {
  return new ProcessJobCompletionConfirmationsUseCase(
    completionConfirmations,
    jobs,
    customerProfiles,
    professionals,
    makeOpenManualReviewCaseUseCase(),
    makeEvaluatePaymentReleaseUseCase(),
    auditLog,
    eventBus,
    notifications,
  );
}

export function makeRunWorkflowExpirationsUseCase() {
  return new RunWorkflowExpirationsUseCase(
    makeExpireServiceRequestsUseCase(),
    makeExpireQuotesUseCase(),
    makeExpireProfessionalVerificationsUseCase(),
    makeExpireCompanyVerificationsUseCase(),
    auditLog,
    makeProcessJobCompletionConfirmationsUseCase(),
  );
}
