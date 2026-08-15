import { PrismaConversationRepository } from "@/infrastructure/database/prisma/repositories/prisma-conversation-repository";
import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaJobRepository } from "@/infrastructure/database/prisma/repositories/prisma-job-repository";
import { PrismaJobCompletionConfirmationRepository } from "@/infrastructure/database/prisma/repositories/prisma-job-completion-confirmation-repository";
import { PrismaMessageRepository } from "@/infrastructure/database/prisma/repositories/prisma-message-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaQuoteRepository } from "@/infrastructure/database/prisma/repositories/prisma-quote-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { PrismaDisputeRepository } from "@/infrastructure/database/prisma/repositories/prisma-dispute-repository";
import { PrismaCompanyMembershipRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-membership-repository";
import { PrismaPaymentRepository } from "@/infrastructure/database/prisma/repositories/prisma-payment-repository";
import { PrismaTrustAutomatedActionRepository } from "@/infrastructure/database/prisma/repositories/prisma-trust-automated-action-repository";
import { PrismaManualReviewCaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-manual-review-case-repository";
import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { ChatJobNotifier } from "@/infrastructure/chat/chat-job-notifier";
import { NotificationServiceCreator } from "@/infrastructure/notifications/notification-service";
import { createFailureReporter } from "@/infrastructure/observability/failure-reporter-factory";
import { eventBus } from "@/infrastructure/events/compose";
import { CancelJobUseCase } from "@/application/use-cases/job/cancel-job.use-case";
import { CompleteJobUseCase } from "@/application/use-cases/job/complete-job.use-case";
import { GetJobUseCase } from "@/application/use-cases/job/get-job.use-case";
import { ListJobsForCustomerUseCase } from "@/application/use-cases/job/list-jobs-for-customer.use-case";
import { ListJobsForProfessionalUseCase } from "@/application/use-cases/job/list-jobs-for-professional.use-case";
import { StartJobUseCase } from "@/application/use-cases/job/start-job.use-case";
import { EvaluatePaymentReleaseUseCase } from "@/application/use-cases/job/evaluate-payment-release.use-case";
import { ConfirmJobCompletionUseCase } from "@/application/use-cases/job/confirm-job-completion.use-case";
import { DisputeJobCompletionUseCase } from "@/application/use-cases/job/dispute-job-completion.use-case";
import { AdminResolvePaymentReleaseUseCase } from "@/application/use-cases/job/admin-resolve-payment-release.use-case";
import { CreateDisputeUseCase } from "@/application/use-cases/dispute/create-dispute.use-case";
import { CheckPayoutEligibilityUseCase } from "@/application/use-cases/verification/check-payout-eligibility.use-case";
import { PrismaProfessionalVerificationRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-verification-repository";

const jobs = new PrismaJobRepository();
const customerProfiles = new PrismaCustomerProfileRepository();
const professionals = new PrismaProfessionalRepository();
const serviceRequests = new PrismaServiceRequestRepository();
const conversations = new PrismaConversationRepository();
const messages = new PrismaMessageRepository();
// Module 63 — Materials Procurement Workflow: supplied to StartJobUseCase
// so its "materials must be confirmed before work begins" gate is always
// active in production — see that use case's own doc comment for why the
// dependency is optional at the class level.
const quotes = new PrismaQuoteRepository();

// Module 66 — Job Completion & Payment Release Protection.
const completionConfirmations = new PrismaJobCompletionConfirmationRepository();
const disputes = new PrismaDisputeRepository();
const companyMembers = new PrismaCompanyMembershipRepository();
const payments = new PrismaPaymentRepository();
const trustAutomatedActions = new PrismaTrustAutomatedActionRepository();
const manualReviewCases = new PrismaManualReviewCaseRepository();
const professionalVerifications = new PrismaProfessionalVerificationRepository();
const auditLog = new PrismaAdminAuditLogRepository();
const failureReporter = createFailureReporter();

const notifier = new ChatJobNotifier(serviceRequests, customerProfiles, professionals, conversations, messages);
const notifications = new NotificationServiceCreator();

export function makeStartJobUseCase() {
  return new StartJobUseCase(jobs, customerProfiles, professionals, notifier, notifications, quotes);
}

export function makeCompleteJobUseCase() {
  return new CompleteJobUseCase(
    jobs,
    customerProfiles,
    professionals,
    notifier,
    notifications,
    completionConfirmations,
    eventBus,
    failureReporter,
  );
}

export function makeCancelJobUseCase() {
  return new CancelJobUseCase(jobs, customerProfiles, professionals, notifier, notifications);
}

export function makeGetJobUseCase() {
  return new GetJobUseCase(jobs, customerProfiles, professionals);
}

export function makeListJobsForCustomerUseCase() {
  return new ListJobsForCustomerUseCase(jobs, customerProfiles);
}

export function makeListJobsForProfessionalUseCase() {
  return new ListJobsForProfessionalUseCase(jobs, professionals);
}

// --- Module 66 — Job Completion & Payment Release Protection ---

export function makeCheckPayoutEligibilityUseCase() {
  // Mirrors verification/compose.ts's own makeCheckPayoutEligibilityUseCase
  // — a second, independent instance rather than importing that module's
  // compose.ts, same "each compose.ts constructs its own cross-module
  // dependencies from Prisma repositories directly" convention
  // dispute/compose.ts already establishes (see that file's own
  // `PrismaJobRepository` import) — avoids a compose-to-compose import
  // cycle between job and verification.
  return new CheckPayoutEligibilityUseCase(professionalVerifications);
}

export function makeEvaluatePaymentReleaseUseCase() {
  return new EvaluatePaymentReleaseUseCase(
    jobs,
    completionConfirmations,
    disputes,
    payments,
    professionals,
    trustAutomatedActions,
    makeCheckPayoutEligibilityUseCase(),
    eventBus,
    failureReporter,
  );
}

export function makeConfirmJobCompletionUseCase() {
  return new ConfirmJobCompletionUseCase(
    jobs,
    completionConfirmations,
    customerProfiles,
    professionals,
    makeEvaluatePaymentReleaseUseCase(),
    eventBus,
    notifications,
    failureReporter,
  );
}

function makeCreateDisputeUseCaseForCompletion() {
  // Same rationale as makeCheckPayoutEligibilityUseCase above — a second
  // instance built from Prisma repositories directly rather than a
  // compose-to-compose import of dispute/compose.ts's own
  // makeCreateDisputeUseCase (which would create a job <-> dispute
  // compose cycle, since dispute/compose.ts already imports
  // PrismaJobRepository).
  return new CreateDisputeUseCase(disputes, jobs, customerProfiles, professionals, companyMembers, eventBus, failureReporter);
}

export function makeDisputeJobCompletionUseCase() {
  return new DisputeJobCompletionUseCase(
    jobs,
    completionConfirmations,
    customerProfiles,
    professionals,
    makeCreateDisputeUseCaseForCompletion(),
    makeEvaluatePaymentReleaseUseCase(),
    failureReporter,
  );
}

export function makeAdminResolvePaymentReleaseUseCase() {
  return new AdminResolvePaymentReleaseUseCase(
    jobs,
    completionConfirmations,
    disputes,
    manualReviewCases,
    payments,
    professionals,
    trustAutomatedActions,
    makeCheckPayoutEligibilityUseCase(),
    eventBus,
    auditLog,
    failureReporter,
  );
}
