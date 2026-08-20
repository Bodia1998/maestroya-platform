import "server-only";

import { env } from "@/infrastructure/config/env";
import { eventBus } from "@/infrastructure/events/compose";
import { getFeatureFlagService } from "@/infrastructure/feature-flags/compose";
import { createDistributedLock } from "@/infrastructure/locking/lock-service-factory";
import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaExternalWebhookEventRepository } from "@/infrastructure/database/prisma/repositories/prisma-external-webhook-event-repository";
import { PrismaJobRepository } from "@/infrastructure/database/prisma/repositories/prisma-job-repository";
import { PrismaJobCompletionConfirmationRepository } from "@/infrastructure/database/prisma/repositories/prisma-job-completion-confirmation-repository";
import { PrismaDisputeRepository } from "@/infrastructure/database/prisma/repositories/prisma-dispute-repository";
import { PrismaCommissionRepository } from "@/infrastructure/database/prisma/repositories/prisma-commission-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaCompanyRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-repository";
import { PrismaTrustAutomatedActionRepository } from "@/infrastructure/database/prisma/repositories/prisma-trust-automated-action-repository";
import { PrismaProfessionalOnboardingRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-onboarding-repository";
import { PrismaCompanyPayoutAccountRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-payout-account-repository";
import { PrismaPaymentRepository } from "@/infrastructure/database/prisma/repositories/prisma-payment-repository";
import { PrismaPayoutRepository } from "@/infrastructure/database/prisma/repositories/prisma-payout-repository";
import { PrismaQuoteRepository } from "@/infrastructure/database/prisma/repositories/prisma-quote-repository";
import { paymentGateway } from "@/infrastructure/payments/compose";
import { stripe } from "@/infrastructure/payments/stripe/client";
import { stripeTransferGateway } from "@/infrastructure/payments/stripe/compose";
import { StripePaymentWebhookVerifierAdapter } from "@/infrastructure/payments/stripe/stripe-payment-webhook-verifier";
import type { StripePaymentWebhookVerifier } from "@/application/ports/stripe-payment-webhook-verifier";
import { createFailureReporter } from "@/infrastructure/observability/failure-reporter-factory";
import { makeRecordCommissionForPaymentUseCase } from "@/application/use-cases/financial/compose";
import { makeCheckPayoutEligibilityUseCase } from "@/application/use-cases/verification/compose";
import { ResolvePayoutDestinationUseCase } from "@/application/use-cases/financial/resolve-payout-destination.use-case";
import { PaymentCaptured } from "@/domain/events/payment-captured";
import { PaymentReleaseApproved } from "@/domain/events/payment-release-approved";
import { InitiateQuotePaymentUseCase } from "./initiate-quote-payment.use-case";
import { ProcessCustomerPaymentWebhookUseCase } from "./process-customer-payment-webhook.use-case";
import { RecordCommissionOnPaymentCapturedSubscriber } from "./record-commission-on-payment-captured.subscriber";
import { ExecuteProfessionalPayoutUseCase } from "./execute-professional-payout.use-case";
import { ExecutePayoutOnReleaseApprovedSubscriber } from "./execute-payout-on-release-approved.subscriber";

/**
 * Module 73 — Real Customer Payment Capture: composition root, same
 * manual-composition convention as every other `compose.ts` in this
 * codebase.
 *
 * Also the module's `eventBus.subscribe(PaymentCaptured, ...)` registration
 * point — see `RecordCommissionOnPaymentCapturedSubscriber`'s own doc
 * comment for why it lives here rather than in `financial/compose.ts`.
 * This file is imported once, deterministically at boot, from
 * `instrumentation.ts`'s subscriber-registration list — see that file's
 * own doc comment.
 *
 * Module 76 — Professional Payout Execution: also this module's
 * `eventBus.subscribe(PaymentReleaseApproved, ...)` registration point —
 * see `ExecutePayoutOnReleaseApprovedSubscriber`'s own doc comment for why
 * it is registered from here (where `ExecuteProfessionalPayoutUseCase`
 * itself is composed) rather than `job/compose.ts` (which publishes the
 * event but, per this codebase's existing "each compose.ts owns its own
 * cross-module Prisma repository instances" convention, never reaches
 * into a sibling module's subscriber registration).
 */
const customerProfiles = new PrismaCustomerProfileRepository();
const jobs = new PrismaJobRepository();
const quotes = new PrismaQuoteRepository();
const payments = new PrismaPaymentRepository();
const webhookEvents = new PrismaExternalWebhookEventRepository();
const lock = createDistributedLock();

// --- Module 76 — Professional Payout Execution ---
const completionConfirmations = new PrismaJobCompletionConfirmationRepository();
const disputes = new PrismaDisputeRepository();
const commissions = new PrismaCommissionRepository();
const professionals = new PrismaProfessionalRepository();
const companies = new PrismaCompanyRepository();
const trustAutomatedActions = new PrismaTrustAutomatedActionRepository();
const professionalOnboardings = new PrismaProfessionalOnboardingRepository();
const companyPayoutAccounts = new PrismaCompanyPayoutAccountRepository();
const payouts = new PrismaPayoutRepository();
const failureReporter = createFailureReporter();
const destinationResolver = new ResolvePayoutDestinationUseCase(professionalOnboardings, companyPayoutAccounts);

const stripePaymentWebhookVerifier: StripePaymentWebhookVerifier = new StripePaymentWebhookVerifierAdapter(
  stripe,
  env.STRIPE_PAYMENTS_WEBHOOK_SECRET,
);

export function getStripePaymentWebhookVerifierInstance(): StripePaymentWebhookVerifier {
  return stripePaymentWebhookVerifier;
}

export function makeInitiateQuotePaymentUseCase(): InitiateQuotePaymentUseCase {
  return new InitiateQuotePaymentUseCase(
    customerProfiles,
    jobs,
    quotes,
    payments,
    paymentGateway,
    lock,
    getFeatureFlagService(),
  );
}

export function makeProcessCustomerPaymentWebhookUseCase(): ProcessCustomerPaymentWebhookUseCase {
  return new ProcessCustomerPaymentWebhookUseCase(payments, paymentGateway, webhookEvents, eventBus);
}

export function makeExecuteProfessionalPayoutUseCase(): ExecuteProfessionalPayoutUseCase {
  return new ExecuteProfessionalPayoutUseCase(
    jobs,
    payments,
    completionConfirmations,
    disputes,
    commissions,
    makeRecordCommissionForPaymentUseCase(),
    professionals,
    companies,
    trustAutomatedActions,
    makeCheckPayoutEligibilityUseCase(),
    destinationResolver,
    payouts,
    stripeTransferGateway,
    lock,
    eventBus,
    failureReporter,
  );
}

eventBus.subscribe(
  PaymentCaptured,
  new RecordCommissionOnPaymentCapturedSubscriber(makeRecordCommissionForPaymentUseCase()),
);

// Module 76 — Professional Payout Execution: see this file's own doc
// comment on why this registration lives here.
eventBus.subscribe(
  PaymentReleaseApproved,
  new ExecutePayoutOnReleaseApprovedSubscriber(makeExecuteProfessionalPayoutUseCase()),
);
