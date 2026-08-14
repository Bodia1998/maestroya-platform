import { NotFoundError } from "@/domain/errors/domain-error";
import type { AffiliateCommissionRecord, AffiliateCommissionRepository } from "@/domain/repositories/affiliate-commission-repository";
import type { PartnerFraudFlagRecord, PartnerFraudFlagRepository } from "@/domain/repositories/partner-fraud-flag-repository";
import type { PartnerPayoutRecord, PartnerPayoutRepository } from "@/domain/repositories/partner-payout-repository";
import type { PartnerRecord, PartnerRepository } from "@/domain/repositories/partner-repository";
import type { ReferralCodeRecord, ReferralCodeRepository } from "@/domain/repositories/referral-code-repository";

/**
 * Module 61 — Affiliate & Partner System: the single admin-panel "audit
 * this partner" read — everything an admin needs on one screen to decide
 * approve/reject/suspend/ban: the partner's own profile, every referral
 * link they've generated (reused straight from Module 60, see
 * `ReferralCodeRepository.findByOwnerUserId`), their full commission
 * ledger, payout history, and any open/resolved fraud flags. Deliberately
 * read-only — this use case never mutates anything; every action an admin
 * takes from this screen is its own dedicated use case
 * (`ApprovePartnerUseCase`, `CancelAffiliateCommissionUseCase`, etc.).
 */
export interface PartnerAudit {
  partner: PartnerRecord;
  referralCodes: ReferralCodeRecord[];
  affiliateCommissions: AffiliateCommissionRecord[];
  payouts: PartnerPayoutRecord[];
  fraudFlags: PartnerFraudFlagRecord[];
}

export class GetAdminPartnerAuditUseCase {
  constructor(
    private readonly partners: PartnerRepository,
    private readonly referralCodes: ReferralCodeRepository,
    private readonly affiliateCommissions: AffiliateCommissionRepository,
    private readonly payouts: PartnerPayoutRepository,
    private readonly fraudFlags: PartnerFraudFlagRepository,
  ) {}

  async execute(partnerId: string): Promise<PartnerAudit> {
    const partner = await this.partners.findById(partnerId);
    if (!partner) {
      throw new NotFoundError("Partner", partnerId);
    }

    const [referralCodes, affiliateCommissions, payouts, fraudFlags] = await Promise.all([
      this.referralCodes.findByOwnerUserId(partner.userId),
      this.affiliateCommissions.listForPartner(partner.id),
      this.payouts.listForPartner(partner.id),
      this.fraudFlags.listForPartner(partner.id),
    ]);

    return { partner, referralCodes, affiliateCommissions, payouts, fraudFlags };
  }
}
