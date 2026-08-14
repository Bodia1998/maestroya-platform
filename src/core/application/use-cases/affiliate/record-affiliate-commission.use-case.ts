import {
  AFFILIATE_COMMISSION_RATE_BPS,
  calculateAffiliateCommission,
  computeAffiliateCommissionExpiry,
} from "@/domain/services/affiliate-commission-policy";
import { isPartnerActiveForAffiliateActivity } from "@/domain/services/partner-approval-rules";
import type { AffiliateCommissionRecord, AffiliateCommissionRepository } from "@/domain/repositories/affiliate-commission-repository";
import type { MarketingAttributionRepository } from "@/domain/repositories/marketing-attribution-repository";
import type { PartnerRepository } from "@/domain/repositories/partner-repository";
import type { ReferralCodeRepository } from "@/domain/repositories/referral-code-repository";

/**
 * Module 61 — Affiliate & Partner System: the use case a future Module 22
 * caller is expected to invoke immediately after
 * `RecordCommissionForPaymentUseCase` (Module 22) creates a `Commission`
 * row AND Module 60's `RecordConversionUseCase` records the matching
 * `COMMISSION_GENERATED` `ConversionEvent` for the same booking — see
 * docs/MODULE_61's "Future Integration" section for the exact call
 * sequence. This use case NEVER computes `platformCommissionAmount`
 * itself; it is handed the already-recorded Module 22 `Commission.amount`
 * verbatim by its caller (dependency inversion, the same reasoning
 * `RecordCommissionForPaymentUseCase` itself gives for never importing the
 * Stripe SDK — Module 22 remains the sole owner of commission
 * calculation).
 *
 * Attribution resolution reuses Module 60 end-to-end:
 *  1. `MarketingAttributionRepository.findByVisitorId(visitorId)` — the
 *     same repository `TrackVisitUseCase`/`RecordConversionUseCase` already
 *     use — to find which referral code (if any) drove this visitor.
 *  2. `ReferralCodeRepository.findByCode` to resolve that code's
 *     `ownerUserId`.
 *  3. `PartnerRepository.findByUserId` to resolve that owner's partner
 *     account, if one exists and is `APPROVED`.
 *
 * Returns `null` (never throws) for every case where no affiliate
 * commission applies — an un-attributed visitor, a referral code with no
 * partner owner, or a partner that isn't `APPROVED` are all simply "this
 * booking has no affiliate to pay," not error conditions. Idempotent on
 * `conversionEventId`: a redelivered/retried call returns the
 * already-recorded row unchanged rather than creating a second one.
 */
export class RecordAffiliateCommissionUseCase {
  constructor(
    private readonly attributions: MarketingAttributionRepository,
    private readonly referralCodes: ReferralCodeRepository,
    private readonly partners: PartnerRepository,
    private readonly affiliateCommissions: AffiliateCommissionRepository,
  ) {}

  async execute(input: {
    visitorId: string;
    conversionEventId: string;
    platformCommissionRefId: string;
    platformCommissionAmount: number;
  }): Promise<AffiliateCommissionRecord | null> {
    const existing = await this.affiliateCommissions.findByConversionEventId(input.conversionEventId);
    if (existing) {
      return existing;
    }

    const attribution = await this.attributions.findByVisitorId(input.visitorId);
    const referralCode = attribution?.lastReferralCode ?? attribution?.firstReferralCode ?? null;
    if (!referralCode) {
      return null;
    }

    const code = await this.referralCodes.findByCode(referralCode);
    if (!code?.ownerUserId) {
      return null;
    }

    const partner = await this.partners.findByUserId(code.ownerUserId);
    if (!partner || !isPartnerActiveForAffiliateActivity(partner.status)) {
      return null;
    }

    const now = new Date();
    const affiliateAmount = calculateAffiliateCommission(input.platformCommissionAmount);

    return this.affiliateCommissions.create({
      partnerId: partner.id,
      referralCode,
      conversionEventId: input.conversionEventId,
      platformCommissionRefId: input.platformCommissionRefId,
      platformCommissionAmount: input.platformCommissionAmount,
      affiliateRateBps: AFFILIATE_COMMISSION_RATE_BPS,
      affiliateAmount,
      expiresAt: computeAffiliateCommissionExpiry(now),
    });
  }
}
