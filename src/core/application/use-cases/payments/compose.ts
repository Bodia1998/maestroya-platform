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
import { PrismaRefundRepository } from "@/infrastructure/database/prisma/repositories/prisma-refund-repository";
import { PrismaFinancialAdjustmentRepository } from "@/infrastructure/database/prisma/repositories/prisma-financial-adjustment-repository";
import { PrismaFinancialLedgerRepository } from "@/infrastructure/database/prisma/repositories/prisma-financial-ledger-repository";
import { PrismaStripeDisputeRepository } from "@/infrastructure/database/prisma/repositories/prisma-stripe-dispute-repository";
import { PrismaQuoteRepository } from "@/infrastructure/database/prisma/repositories/prisma-quote-repository";
import { paymentGateway } from "@/infrastructure/payments/compose";
import { stripe } from "@/infrastructure/payments/stripe/client";
import { stripeTransferGateway } from "@/infrastructure/payments/stripe/compose";
import { StripePaymentWebhookVerifierAdapter } from "@/infrastructure/payments/stripe/stripe-payment-webhook-verifier";
import type { StripePaymentWebhookVerifier } from "@/application/ports/stripe-payment-webhook-verifier";
import { createFailureReporter } from "@/infrastructure/observability/failure-reporter-factory";
import { makeRecordCommissionForPaymentUseCase } from "@/application/use-cases/financial/compose";
import { makeCheckPayoutEligibilityUseCase } from "@/application/use-cases/verification/compose";
import { makeCheckInvoiceRequiredForPayoutUseCase } from "@/application/use-cases/invoicing/compose";
// Module 96 — Referral & Affiliate Production Wiring: side-effect import
// only — registers RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber
// against the same PaymentReleaseApproved event this file's own
// ExecutePayoutOnReleaseApprovedSubscriber already subscribes to. Mirrors
// `makeCheckInvoiceRequiredForPayoutUseCase`'s import of
// `invoicing/compose` immediately above, which pulls in that module's own
// PaymentReleaseApproved subscriber registration the identical way.
import "@/application/use-cases/affiliate/compose";
import { ResolvePayoutDestinationUseCase } from "@/application/use-cases/financial/resolve-payout-destination.use-case";
import { PaymentCaptured } from "@/domain/events/payment-captured";
import { PaymentReleaseApproved } from "@/domain/events/payment-release-approved";
import { InitiateQuotePaymentUseCase } from "./initiate-quote-payment.use-case";
import { ProcessCustomerPaymentWebhookUseCase } from "./process-customer-payment-webhook.use-case";
import { RecordCommissionOnPaymentCapturedSubscriber } from "./record-commission-on-payment-captured.subscriber";
import { ExecuteProfessionalPayoutUseCase } from "./execute-professional-payout.use-case";
import { ExecutePayoutOnReleaseApprovedSubscriber } from "./execute-payout-on-release-approved.subscriber";
import { CreateFinancialAdjustmentUseCase } from "@/application/use-cases/financial/create-financial-adjustment.use-case";
import { ExecuteRefundUseCase } from "@/application/use-cases/refunds/execute-refund.use-case";
import { ReverseProfessionalPayoutUseCase } from "@/application/use-cases/refunds/reverse-professional-payout.use-case";
import {
  RecordPaymentRefundedAuditLogSubscriber,
  RecordRefundFailedAuditLogSubscriber,
  RecordProfessionalPayoutReversedAuditLogSubscriber,
  RecordPayoutReversalFailedAuditLogSubscriber,
} from "@/application/use-cases/refunds/record-refund-audit-log.subscriber";
import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PaymentRefunded } from "@/domain/events/payment-refunded";
import { RefundFailed } from "@/domain/events/refund-failed";
import { ProfessionalPayoutReversed } from "@/domain/events/professional-payout-reversed";
import { PayoutReversalFailed } from "@/domain/events/payout-reversal-failed";
import { ProcessStripeDisputeWebhookUseCase } from "@/application/use-cases/stripe-disputes/process-stripe-dispute-webhook.use-case";
import {
  RecordStripeDisputeOpenedAuditLogSubscriber,
  RecordStripeDisputeClosedAuditLogSubscriber,
} from "@/application/use-cases/stripe-disputes/record-stripe-dispute-audit-log.subscriber";
import { StripeDisputeOpened } from "@/domain/events/stripe-dispute-opened";
import { StripeDisputeClosed } from "@/domain/events/stripe-dispute-closed";

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

// --- Module 77 — Refund & Dispute Financial Execution ---
// Reuses the already-composed `jobs`/`commissions`/`payments` instances
// above — no second Prisma repository instance is created for any of
// them, matching this file's own "each compose.ts owns its own
// cross-module Prisma repository instances, but never a second instance
// of the same one within itself" convention.
const refunds = new PrismaRefundRepository();
const financialAdjustments = new PrismaFinancialAdjustmentRepository();
const financialLedger = new PrismaFinancialLedgerRepository();

// --- Module 86 — Stripe Chargeback & Dispute Handling ---
const stripeDisputes = new PrismaStripeDisputeRepository();

function makeCreateFinancialAdjustmentUseCaseForRefunds() {
  return new CreateFinancialAdjustmentUseCase(jobs, financialAdjustments, financialLedger, payments);
}

export function makeReverseProfessionalPayoutUseCase(): ReverseProfessionalPayoutUseCase {
  return new ReverseProfessionalPayoutUseCase(
    payouts,
    stripeTransferGateway,
    commissions,
    makeCreateFinancialAdjustmentUseCaseForRefunds(),
    eventBus,
    failureReporter,
  );
}

export function makeExecuteRefundUseCase(): ExecuteRefundUseCase {
  return new ExecuteRefundUseCase(
    payments,
    refunds,
    payouts,
    paymentGateway,
    makeReverseProfessionalPayoutUseCase(),
    lock,
    eventBus,
    failureReporter,
  );
}
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

export function makeProcessStripeDisputeWebhookUseCase(): ProcessStripeDisputeWebhookUseCase {
  return new ProcessStripeDisputeWebhookUseCase({
    disputes: stripeDisputes,
    payments,
    payouts,
    financialAdjustments,
    createFinancialAdjustment: makeCreateFinancialAdjustmentUseCaseForRefunds(),
    reversePayout: makeReverseProfessionalPayoutUseCase(),
    lock,
    eventBus,
    // Module 86 — Stripe Chargeback & Dispute Handling: see
    // env.STRIPE_DISPUTE_SYSTEM_USER_ID's own doc comment — `undefined`
    // (unset) becomes `null` here, which
    // ProcessStripeDisputeWebhookUseCase treats as "defer the financial
    // settlement and report for manual review" rather than fabricating
    // an actor.
    systemActorUserId: env.STRIPE_DISPUTE_SYSTEM_USER_ID ?? null,
    failureReporter,
  });
}

export function makeProcessCustomerPaymentWebhookUseCase(): ProcessCustomerPaymentWebhookUseCase {
  return new ProcessCustomerPaymentWebhookUseCase(
    payments,
    paymentGateway,
    webhookEvents,
    eventBus,
    failureReporter,
    refunds,
    makeProcessStripeDisputeWebhookUseCase(),
    financialLedger,
  );
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
    // Module 79 — Invoicing & Credit Notes: optional invoice-state
    // prerequisite — see ExecuteProfessionalPayoutUseCase's own updated
    // constructor doc comment. `requireInvoiceForPayout: false` — a Job
    // with no invoice at all is not yet blocked, matching a rollout where
    // not every historical Job has one; a Job that DOES have an invoice
    // is always held to the ISSUED-or-later bar regardless.
    makeCheckInvoiceRequiredForPayoutUseCase(),
    false,
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

// Module 77 — Refund & Dispute Financial Execution: audit-log subscriber
// registrations, same convention as `dispute-resolution/compose.ts`'s own
// `DisputeFinancialOutcomeDetermined` registration.
const refundAuditLog = new PrismaAdminAuditLogRepository();
eventBus.subscribe(PaymentRefunded, new RecordPaymentRefundedAuditLogSubscriber(refundAuditLog));
eventBus.subscribe(RefundFailed, new RecordRefundFailedAuditLogSubscriber(refundAuditLog));
eventBus.subscribe(ProfessionalPayoutReversed, new RecordProfessionalPayoutReversedAuditLogSubscriber(refundAuditLog));
eventBus.subscribe(PayoutReversalFailed, new RecordPayoutReversalFailedAuditLogSubscriber(refundAuditLog));

// Module 86 — Stripe Chargeback & Dispute Handling: audit-log subscriber
// registrations, same convention as this file's own Module 77
// registrations immediately above.
eventBus.subscribe(StripeDisputeOpened, new RecordStripeDisputeOpenedAuditLogSubscriber(refundAuditLog));
eventBus.subscribe(StripeDisputeClosed, new RecordStripeDisputeClosedAuditLogSubscriber(refundAuditLog));
