import { PrismaAffiliateCommissionRepository } from "@/infrastructure/database/prisma/repositories/prisma-affiliate-commission-repository";
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
const referralCodes = new PrismaReferralCodeRepository();
const referralVisits = new PrismaReferralVisitRepository();
const marketingAttributions = new PrismaMarketingAttributionRepository();
const conversionEvents = new PrismaConversionEventRepository();
const affiliateCommissions = new PrismaAffiliateCommissionRepository();
const partnerPayouts = new PrismaPartnerPayoutRepository();
const partnerFraudFlags = new PrismaPartnerFraudFlagRepository();

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

export function makeRecordAffiliateCommissionUseCase() {
  return new RecordAffiliateCommissionUseCase(marketingAttributions, referralCodes, partners, affiliateCommissions);
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
  return new CreatePartnerPayoutUseCase(partners, affiliateCommissions, partnerPayouts);
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
