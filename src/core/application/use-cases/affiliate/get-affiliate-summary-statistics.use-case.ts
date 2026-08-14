import type { AffiliateCommissionRepository } from "@/domain/repositories/affiliate-commission-repository";
import type { PartnerFraudFlagRepository } from "@/domain/repositories/partner-fraud-flag-repository";
import type { PartnerRepository } from "@/domain/repositories/partner-repository";

/**
 * Module 61 — Affiliate & Partner System: the platform-wide summary
 * consumed by `scripts/run-affiliate-report.ts` — deliberately distinct
 * from `GetPartnerDashboardStatisticsUseCase` (which is scoped to one
 * partner). Pure aggregation, no business rule of its own.
 */
export interface AffiliateSummaryStatistics {
  totalPartners: number;
  pendingPartners: number;
  approvedPartners: number;
  suspendedPartners: number;
  bannedPartners: number;
  rejectedPartners: number;
  totalAffiliateCommissions: number;
  pendingCommissionTotal: number;
  approvedCommissionTotal: number;
  paidCommissionTotal: number;
  totalPlatformCommissionGenerated: number;
  openFraudFlags: number;
}

export class GetAffiliateSummaryStatisticsUseCase {
  constructor(
    private readonly partners: PartnerRepository,
    private readonly affiliateCommissions: AffiliateCommissionRepository,
    private readonly fraudFlags: PartnerFraudFlagRepository,
  ) {}

  async execute(): Promise<AffiliateSummaryStatistics> {
    const [pendingPartners, approvedPartners, suspendedPartners, bannedPartners, rejectedPartners, allPartners, openFlags] =
      await Promise.all([
        this.partners.countByStatus("PENDING"),
        this.partners.countByStatus("APPROVED"),
        this.partners.countByStatus("SUSPENDED"),
        this.partners.countByStatus("BANNED"),
        this.partners.countByStatus("REJECTED"),
        this.partners.list(),
        this.fraudFlags.listOpen(),
      ]);

    let totalAffiliateCommissions = 0;
    let pendingCommissionTotal = 0;
    let approvedCommissionTotal = 0;
    let paidCommissionTotal = 0;
    let totalPlatformCommissionGenerated = 0;

    for (const partner of allPartners) {
      const commissions = await this.affiliateCommissions.listForPartner(partner.id);
      totalAffiliateCommissions += commissions.length;
      for (const c of commissions) {
        totalPlatformCommissionGenerated += c.platformCommissionAmount;
        if (c.status === "PENDING") pendingCommissionTotal += c.affiliateAmount;
        if (c.status === "APPROVED") approvedCommissionTotal += c.affiliateAmount;
        if (c.status === "PAID") paidCommissionTotal += c.affiliateAmount;
      }
    }

    return {
      totalPartners: allPartners.length,
      pendingPartners,
      approvedPartners,
      suspendedPartners,
      bannedPartners,
      rejectedPartners,
      totalAffiliateCommissions,
      pendingCommissionTotal,
      approvedCommissionTotal,
      paidCommissionTotal,
      totalPlatformCommissionGenerated,
      openFraudFlags: openFlags.length,
    };
  }
}
