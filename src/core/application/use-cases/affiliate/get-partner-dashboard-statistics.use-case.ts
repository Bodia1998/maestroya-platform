import { NotFoundError } from "@/domain/errors/domain-error";
import type { AffiliateCommissionRepository, AffiliateEarningsTotals } from "@/domain/repositories/affiliate-commission-repository";
import type { ConversionEventRepository } from "@/domain/repositories/conversion-event-repository";
import type { MarketingAttributionRepository } from "@/domain/repositories/marketing-attribution-repository";
import type { PartnerRepository } from "@/domain/repositories/partner-repository";
import type { ReferralCodeRepository } from "@/domain/repositories/referral-code-repository";
import type { ReferralVisitRepository, TopCampaignStat, TopReferralCodeStat } from "@/domain/repositories/referral-visit-repository";

/**
 * Module 61 — Affiliate & Partner System: the Partner Dashboard's
 * reporting projection — every figure required by the module spec's
 * "Partner Dashboard" section, scoped to exactly one partner's own
 * referral codes. Pure aggregation over Module 60's repositories (reused,
 * never duplicated — see `ReferralCodeRepository.findByOwnerUserId`,
 * `ReferralVisitRepository.listByReferralCodes`,
 * `MarketingAttributionRepository.listByReferralCodes`, all added by this
 * module for exactly this purpose) plus this module's own
 * `AffiliateCommissionRepository`. Same "divide-by-zero is 0, not
 * NaN/Infinity" convention `GetReferralStatisticsUseCase.rate` documents.
 *
 * Not optimized for a partner with an extremely large number of attributed
 * visitors — conversions are fetched one attribution at a time via
 * `ConversionEventRepository.listByAttributionId` (there is no
 * "list by many attributionIds" batch method in Module 60 today). This is
 * an accepted, documented limitation (see docs/MODULE_61's "Remaining
 * Limitations") rather than a reason to add batch query methods to Module
 * 60 speculatively.
 */
export interface PartnerDashboardStatistics {
  clicks: number;
  visits: number;
  registrations: number;
  professionalRegistrations: number;
  customerRegistrations: number;
  bookingsCreated: number;
  completedJobs: number;
  platformCommissionGenerated: number;
  affiliateEarnings: AffiliateEarningsTotals;
  conversionRate: number;
  topCampaigns: TopCampaignStat[];
  topReferralCodes: TopReferralCodeStat[];
}

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 10000;
}

function topN<T extends { visits: number }>(counts: Map<string, number>, key: "campaign" | "referralCode", limit: number): T[] {
  return [...counts.entries()]
    .map(([k, visits]) => ({ [key]: k, visits }) as unknown as T)
    .sort((a, b) => b.visits - a.visits)
    .slice(0, limit);
}

export class GetPartnerDashboardStatisticsUseCase {
  constructor(
    private readonly partners: PartnerRepository,
    private readonly referralCodes: ReferralCodeRepository,
    private readonly visits: ReferralVisitRepository,
    private readonly attributions: MarketingAttributionRepository,
    private readonly conversions: ConversionEventRepository,
    private readonly affiliateCommissions: AffiliateCommissionRepository,
    private readonly topLimit: number = 10,
  ) {}

  async execute(partnerId: string): Promise<PartnerDashboardStatistics> {
    const partner = await this.partners.findById(partnerId);
    if (!partner) {
      throw new NotFoundError("Partner", partnerId);
    }

    const codes = (await this.referralCodes.findByOwnerUserId(partner.userId)).map((c) => c.code);
    const partnerVisits = await this.visits.listByReferralCodes(codes);
    const partnerAttributions = await this.attributions.listByReferralCodes(codes);

    const allConversions = (
      await Promise.all(partnerAttributions.map((a) => this.conversions.listByAttributionId(a.id)))
    ).flat();

    const countByType = (type: (typeof allConversions)[number]["type"]) => allConversions.filter((c) => c.type === type).length;

    const registrations = countByType("REGISTRATION");
    const professionalRegistrations = countByType("PROFESSIONAL_REGISTRATION");
    const customerRegistrations = countByType("CLIENT_REGISTRATION");
    const bookingsCreated = countByType("BOOKING_CREATED");
    const completedJobs = countByType("BOOKING_COMPLETED");

    const affiliateEarnings = await this.affiliateCommissions.totalsForPartner(partner.id);
    const partnerAffiliateCommissions = await this.affiliateCommissions.listForPartner(partner.id);
    const platformCommissionGenerated = partnerAffiliateCommissions.reduce((sum, c) => sum + c.platformCommissionAmount, 0);

    const campaignCounts = new Map<string, number>();
    const codeCounts = new Map<string, number>();
    for (const v of partnerVisits) {
      const campaignKey = v.utmCampaign ?? v.referralCode;
      if (campaignKey) campaignCounts.set(campaignKey, (campaignCounts.get(campaignKey) ?? 0) + 1);
      if (v.referralCode) codeCounts.set(v.referralCode, (codeCounts.get(v.referralCode) ?? 0) + 1);
    }

    return {
      clicks: partnerVisits.length,
      visits: partnerVisits.length,
      registrations,
      professionalRegistrations,
      customerRegistrations,
      bookingsCreated,
      completedJobs,
      platformCommissionGenerated,
      affiliateEarnings,
      conversionRate: rate(registrations, partnerVisits.length),
      topCampaigns: topN<TopCampaignStat>(campaignCounts, "campaign", this.topLimit),
      topReferralCodes: topN<TopReferralCodeStat>(codeCounts, "referralCode", this.topLimit),
    };
  }
}
