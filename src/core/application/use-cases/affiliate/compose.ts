import "server-only";

import { eventBus } from "@/infrastructure/events/compose";
import { createFailureReporter } from "@/infrastructure/observability/failure-reporter-factory";
import { PrismaPaymentRepository } from "@/infrastructure/database/prisma/repositories/prisma-payment-repository";
import { PrismaAffiliateCommissionRepository } from "@/infrastructure/database/prisma/repositories/prisma-affiliate-commission-repository";
import { PrismaAffiliateCommissionReversalRepository } from "@/infrastructure/database/prisma/repositories/prisma-affiliate-commission-reversal-repository";
import { PrismaFinancialLedgerRepository } from "@/infrastructure/database/prisma/repositories/prisma-financial-ledger-repository";
import { PrismaCommissionRepository } from "@/infrastructure/database/prisma/repositories/prisma-commission-repository";
import { PrismaConversionEventRepository } from "@/infrastructure/database/prisma/repositories/prisma-conversion-event-repository";
import { PrismaMarketingAttributionRepository } from "@/infrastructure/database/prisma/repositories/prisma-marketing-attribution-repository";
import { PrismaPartnerFraudFlagRepository } from "@/infrastructure/database/prisma/repositories/prisma-partner-fraud-flag-repository";
import { PrismaPartnerPayoutRepository } from "@/infrastructure/database/prisma/repositories/prisma-partner-payout-repository";
import { PrismaPartnerRepository } from "@/infrastructure/database/prisma/repositories/prisma-partner-repository";
import { PrismaReferralCodeRepository } from "@/infrastructure/database/prisma/repositories/prisma-referral-code-repository";
import { PrismaReferralVisitRepository } from "@/infrastructure/database/prisma/repositories/prisma-referral-visit-repository";
import { CreateReferralCodeUseCase } from "@/application/use-cases/referral/create-referral-code.use-case";
import { ApprovePartnerUseCase } from "@/application/use-cases/affiliate/approve-partner.use-case";
import { RejectPartnerUseCase } from "@/application/use-cases/affiliate/reject-partner.use-case";
import { SuspendPartnerUseCase } from "@/application/use-cases/affiliate/suspend-partner.use-case";
import { BanPartnerUseCase } from "@/application/use-cases/affiliate/ban-partner.use-case";
import { RegisterPartnerUseCase } from "@/application/use-cases/affiliate/register-partner.use-case";
import { GeneratePartnerReferralLinkUseCase } from "@/application/use-cases/affiliate/generate-partner-referral-link.use-case";
import { SetReferralCodeActiveUseCase } from "@/application/use-cases/affiliate/set-referral-code-active.use-case";
import { ListPartnerReferralCodesUseCase } from "@/application/use-cases/affiliate/list-partner-referral-codes.use-case";
import { RecordAffiliateCommissionUseCase } from "@/application/use-cases/affiliate/record-affiliate-commission.use-case";
import { ApproveAffiliateCommissionUseCase } from "@/application/use-cases/affiliate/approve-affiliate-commission.use-case";
import { CancelAffiliateCommissionUseCase } from "@/application/use-cases/affiliate/cancel-affiliate-commission.use-case";
import { ExpireAffiliateCommissionsUseCase } from "@/application/use-cases/affiliate/expire-affiliate-commissions.use-case";
import { CreatePartnerPayoutUseCase } from "@/application/use-cases/affiliate/create-partner-payout.use-case";
import { GetPartnerDashboardStatisticsUseCase } from "@/application/use-cases/affiliate/get-partner-dashboard-statistics.use-case";
import { DetectPartnerFraudSignalsUseCase } from "@/application/use-cases/affiliate/detect-partner-fraud-signals.use-case";
import { ListAdminPartnersUseCase } from "@/application/use-cases/affiliate/list-admin-partners.use-case";
import { GetAdminPartnerAuditUseCase } from "@/application/use-cases/affiliate/get-admin-partner-audit.use-case";
import { GetAffiliateSummaryStatisticsUseCase } from "@/application/use-cases/affiliate/get-affiliate-summary-statistics.use-case";
import { GetPartnerByUserIdUseCase } from "@/application/use-cases/affiliate/get-partner-by-user-id.use-case";
import { RunReferralAffiliateMaintenanceSweepUseCase } from "@/application/use-cases/affiliate/run-referral-affiliate-maintenance-sweep.use-case";
import { createDistributedLock } from "@/infrastructure/locking/lock-service-factory";
import { RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber } from "@/application/use-cases/affiliate/record-affiliate-conversion-on-payment-release-approved.subscriber";
import { ReverseAffiliateCommissionUseCase } from "@/application/use-cases/affiliate/reverse-affiliate-commission.use-case";
import { ReconcileAffiliateCommissionStripeFeeUseCase } from "@/application/use-cases/affiliate/reconcile-affiliate-commission-stripe-fee.use-case";
import { ReconcileStuckPartnerPayoutUseCase } from "@/application/use-cases/affiliate/reconcile-stuck-partner-payout.use-case";
import { FinalizeOverdueAffiliateCommissionFeesUseCase } from "@/application/use-cases/affiliate/finalize-overdue-affiliate-commission-fees.use-case";
import { ReverseAffiliateCommissionOnPaymentRefundedSubscriber } from "@/application/use-cases/affiliate/reverse-affiliate-commission-on-payment-refunded.subscriber";
import { ReverseAffiliateCommissionOnStripeDisputeLostSubscriber } from "@/application/use-cases/affiliate/reverse-affiliate-commission-on-stripe-dispute-lost.subscriber";
import { PaymentReleaseApproved } from "@/domain/events/payment-release-approved";
import { PaymentRefunded } from "@/domain/events/payment-refunded";
import { StripeDisputeClosed } from "@/domain/events/stripe-dispute-closed";
import { makeRecordCommissionForPaymentUseCase } from "@/application/use-cases/financial/compose";
import { stripeTransferGateway } from "@/infrastructure/payments/stripe/compose";
import { makeRecordConversionUseCase } from "@/application/use-cases/referral/compose";

/**
 * Module 61 — Affiliate & Partner System: composition root — same "one
 * shared repository instance, one factory function per use case"
 * convention `application/use-cases/referral/compose.ts` establishes.
 * Deliberately re-instantiates its own `PrismaReferralCodeRepository`/
 * `PrismaMarketingAttributionRepository`/`PrismaConversionEventRepository`
 * rather than importing the singletons from `referral/compose.ts` — both
 * modules' repositories are stateless wrappers around the same shared
 * `prisma` client, so a second instance is not a second source of truth,
 * only a second (cheap) object; this keeps the two modules' composition
 * roots independently importable without a circular/cross-module import.
 */
const partners = new PrismaPartnerRepository();
const financialLedger = new PrismaFinancialLedgerRepository();
const referralCodes = new PrismaReferralCodeRepository();
const referralVisits = new PrismaReferralVisitRepository();
const marketingAttributions = new PrismaMarketingAttributionRepository();
const conversionEvents = new PrismaConversionEventRepository();
const affiliateCommissions = new PrismaAffiliateCommissionRepository();
const partnerPayouts = new PrismaPartnerPayoutRepository();
const partnerFraudFlags = new PrismaPartnerFraudFlagRepository();
const payments = new PrismaPaymentRepository();
const commissions = new PrismaCommissionRepository();
const affiliateCommissionReversals = new PrismaAffiliateCommissionReversalRepository();
const failureReporter = createFailureReporter();

export function makeRegisterPartnerUseCase() {
  return new RegisterPartnerUseCase(partners);
}

export function makeApprovePartnerUseCase() {
  return new ApprovePartnerUseCase(partners);
}

export function makeRejectPartnerUseCase() {
  return new RejectPartnerUseCase(partners);
}

export function makeSuspendPartnerUseCase() {
  return new SuspendPartnerUseCase(partners);
}

export function makeBanPartnerUseCase() {
  return new BanPartnerUseCase(partners);
}

export function makeGeneratePartnerReferralLinkUseCase() {
  return new GeneratePartnerReferralLinkUseCase(partners, new CreateReferralCodeUseCase(referralCodes));
}

export function makeSetReferralCodeActiveUseCase() {
  return new SetReferralCodeActiveUseCase(partners, referralCodes);
}

export function makeListPartnerReferralCodesUseCase() {
  return new ListPartnerReferralCodesUseCase(partners, referralCodes, referralVisits);
}

export function makeRecordAffiliateCommissionUseCase() {
  return new RecordAffiliateCommissionUseCase(marketingAttributions, referralCodes, partners, affiliateCommissions, partnerFraudFlags);
}

export function makeApproveAffiliateCommissionUseCase() {
  return new ApproveAffiliateCommissionUseCase(affiliateCommissions);
}

export function makeCancelAffiliateCommissionUseCase() {
  return new CancelAffiliateCommissionUseCase(affiliateCommissions);
}

export function makeExpireAffiliateCommissionsUseCase() {
  return new ExpireAffiliateCommissionsUseCase(affiliateCommissions);
}

export function makeCreatePartnerPayoutUseCase() {
  return new CreatePartnerPayoutUseCase(partners, affiliateCommissions, partnerPayouts, stripeTransferGateway);
}

export function makeReconcileAffiliateCommissionStripeFeeUseCase() {
  return new ReconcileAffiliateCommissionStripeFeeUseCase(affiliateCommissions, affiliateCommissionReversals, financialLedger, commissions);
}

/**
 * Module 96 Financial Fix Pass — the payments webhook route's own
 * composition-boundary hook: resolves a Stripe-fee-bearing `paymentId`
 * back to the Module 22 `Commission.id` that any `AffiliateCommission`
 * would be snapshotted from (`platformCommissionRefId`), then runs the
 * reconciliation use case. Lives here (not inside
 * `ProcessCustomerPaymentWebhookUseCase`, Module 73) deliberately — that
 * use case has no dependency on the affiliate module today, and this
 * function is exactly the kind of cross-module orchestration this
 * codebase's route-handler composition boundary already exists for (see
 * `affiliate/compose.ts`'s own reuse of `PrismaPaymentRepository`
 * directly, the identical pattern). Never throws — the caller (the
 * webhook route) must still return 200 to Stripe even if reconciliation
 * itself fails; every failure is logged and swallowed here so the
 * caller doesn't need its own try/catch for this specific call.
 */
export async function reconcileAffiliateCommissionStripeFeeForPayment(paymentId: string): Promise<void> {
  try {
    const commission = await commissions.findByPaymentId(paymentId);
    if (!commission) return;
    await makeReconcileAffiliateCommissionStripeFeeUseCase().execute({ platformCommissionRefId: commission.id });
  } catch (error) {
    failureReporter.report(error, { context: "reconcileAffiliateCommissionStripeFeeForPayment", paymentId });
  }
}

export function makeGetPartnerDashboardStatisticsUseCase() {
  return new GetPartnerDashboardStatisticsUseCase(
    partners,
    referralCodes,
    referralVisits,
    marketingAttributions,
    conversionEvents,
    affiliateCommissions,
  );
}

export function makeDetectPartnerFraudSignalsUseCase() {
  return new DetectPartnerFraudSignalsUseCase(partners, referralCodes, referralVisits, marketingAttributions, conversionEvents, partnerFraudFlags);
}

export function makeListAdminPartnersUseCase() {
  return new ListAdminPartnersUseCase(partners);
}

export function makeGetAdminPartnerAuditUseCase() {
  return new GetAdminPartnerAuditUseCase(partners, referralCodes, affiliateCommissions, partnerPayouts, partnerFraudFlags);
}

export function makeGetAffiliateSummaryStatisticsUseCase() {
  return new GetAffiliateSummaryStatisticsUseCase(partners, affiliateCommissions, partnerFraudFlags);
}

export function makeGetPartnerByUserIdUseCase() {
  return new GetPartnerByUserIdUseCase(partners);
}

/** Module 96 — the admin partner-audit UI's own fraud-flag resolution
 *  action needs direct repository access (a plain status/resolution
 *  update, no additional business logic to warrant its own use case) —
 *  exposed here rather than each Server Action re-instantiating its own
 *  `PrismaPartnerFraudFlagRepository`, so there is exactly one shared
 *  instance, matching every other repository in this composition root. */
export function getPartnerFraudFlagsRepository() {
  return partnerFraudFlags;
}

export function makeReconcileStuckPartnerPayoutUseCase() {
  return new ReconcileStuckPartnerPayoutUseCase(partners, affiliateCommissions, partnerPayouts, stripeTransferGateway);
}

export function makeFinalizeOverdueAffiliateCommissionFeesUseCase() {
  return new FinalizeOverdueAffiliateCommissionFeesUseCase(affiliateCommissions);
}

export function makeRunReferralAffiliateMaintenanceSweepUseCase() {
  return new RunReferralAffiliateMaintenanceSweepUseCase(
    makeExpireAffiliateCommissionsUseCase(),
    makeDetectPartnerFraudSignalsUseCase(),
    partners,
    createDistributedLock(),
    failureReporter,
    makeReconcileAffiliateCommissionStripeFeeUseCase(),
    affiliateCommissions,
    makeReconcileStuckPartnerPayoutUseCase(),
    partnerPayouts,
    makeFinalizeOverdueAffiliateCommissionFeesUseCase(),
  );
}

export function makeReverseAffiliateCommissionUseCase() {
  return new ReverseAffiliateCommissionUseCase(affiliateCommissions, affiliateCommissionReversals);
}

/**
 * Module 96 — Referral & Affiliate Production Wiring: registers the one
 * production caller of `RecordConversionUseCase`'s `COMMISSION_GENERATED`
 * path and `RecordAffiliateCommissionUseCase` — see
 * `RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber`'s own doc
 * comment for why `PaymentReleaseApproved` (Module 66) is the correct
 * trigger. Module-level side effect, same convention
 * `invoicing/compose.ts`/`payments/compose.ts` already establish for
 * every other subscriber registration — this file must be imported
 * (transitively, from `payments/compose.ts`) for the registration to
 * actually run.
 */
eventBus.subscribe(
  PaymentReleaseApproved,
  new RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber(
    payments,
    marketingAttributions,
    makeRecordCommissionForPaymentUseCase(),
    makeRecordConversionUseCase(),
    makeRecordAffiliateCommissionUseCase(),
    failureReporter,
    financialLedger,
  ),
);

/**
 * Module 96 — Referral & Affiliate Production Wiring: registers the
 * refund/chargeback reversal side of the affiliate commission lifecycle
 * — see `ReverseAffiliateCommissionOnPaymentRefundedSubscriber`'s own doc
 * comment for why Module 77's existing `PaymentRefunded` is the correct,
 * non-duplicated trigger.
 */
eventBus.subscribe(
  PaymentRefunded,
  new ReverseAffiliateCommissionOnPaymentRefundedSubscriber(
    payments,
    commissions,
    affiliateCommissions,
    makeReverseAffiliateCommissionUseCase(),
    failureReporter,
  ),
);

/**
 * Module 96 — Referral & Affiliate Production Wiring: registers the
 * chargeback/dispute reversal side of the affiliate commission lifecycle
 * — see `ReverseAffiliateCommissionOnStripeDisputeLostSubscriber`'s own
 * doc comment for why Module 86's existing `StripeDisputeClosed` is the
 * correct, non-duplicated trigger, and how it reuses the exact same
 * `ReverseAffiliateCommissionUseCase` the refund path (above) already
 * uses.
 */
eventBus.subscribe(
  StripeDisputeClosed,
  new ReverseAffiliateCommissionOnStripeDisputeLostSubscriber(
    payments,
    commissions,
    affiliateCommissions,
    makeReverseAffiliateCommissionUseCase(),
    failureReporter,
  ),
);
