import { NotFoundError } from "@/domain/errors/domain-error";
import type { PartnerPayoutRecord, PartnerPayoutRepository } from "@/domain/repositories/partner-payout-repository";
import type { PartnerRepository } from "@/domain/repositories/partner-repository";

/**
 * Module 100 — Affiliate Accumulated Balance & €50 Payout: the partner
 * dashboard's payout-history projection — "pages call use cases, never
 * repositories directly" (same convention `GetPartnerDashboardStatisticsUseCase`
 * and every other partner dashboard use case already follows), wrapping
 * `PartnerPayoutRepository.listForPartner` (added by Module 96, already
 * scoped to exactly one partner — no query parameter through which one
 * partner could list another's payout history).
 */
export class ListAffiliatePayoutsUseCase {
  constructor(
    private readonly partners: PartnerRepository,
    private readonly payouts: PartnerPayoutRepository,
  ) {}

  async execute(partnerId: string): Promise<PartnerPayoutRecord[]> {
    const partner = await this.partners.findById(partnerId);
    if (!partner) {
      throw new NotFoundError("Partner", partnerId);
    }
    return this.payouts.listForPartner(partnerId);
  }
}
