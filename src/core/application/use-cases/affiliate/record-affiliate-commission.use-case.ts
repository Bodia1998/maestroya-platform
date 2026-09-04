import {
  AFFILIATE_COMMISSION_RATE_BPS,
  calculateAffiliateCommission,
  computeAffiliateCommissionExpiry,
} from "@/domain/services/affiliate-commission-policy";
import { detectSelfReferral } from "@/domain/services/affiliate-fraud-rules";
import { isPartnerActiveForAffiliateActivity } from "@/domain/services/partner-approval-rules";
import type { AffiliateCommissionRecord, AffiliateCommissionRepository } from "@/domain/repositories/affiliate-commission-repository";
import type { MarketingAttributionRepository } from "@/domain/repositories/marketing-attribution-repository";
import type { PartnerFraudFlagRepository } from "@/domain/repositories/partner-fraud-flag-repository";
import type { PartnerRepository } from "@/domain/repositories/partner-repository";
import type { ReferralCodeRepository } from "@/domain/repositories/referral-code-repository";
import { logger } from "@/infrastructure/observability/logger";

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
    /** Module 96 — Referral & Affiliate Production Wiring: optional so
     *  every pre-96 test/caller (constructed without a 5th argument)
     *  keeps compiling — a `null` here means the self-referral check
     *  below is skipped entirely rather than crashing, matching this
     *  codebase's "every new optional collaborator degrades safely, never
     *  throws for a caller that hasn't been updated yet" convention (see
     *  `RegisterUserUseCase`'s own `attributionLinker?` for the same
     *  pattern). Every real production composition (`affiliate/compose.ts`)
     *  always supplies the real repository — self-referral blocking is
     *  never actually skipped in production. */
    private readonly fraudFlags: PartnerFraudFlagRepository | null = null,
  ) {}

  async execute(input: {
    visitorId: string;
    conversionEventId: string;
    platformCommissionRefId: string;
    platformCommissionAmount: number;
    /** Module 96 — directly attributable transaction cost (Stripe
     *  processing fee, refund/dispute loss) already known at commission-
     *  creation time. Defaults to 0 — see
     *  `affiliate-commission-policy.ts`'s own doc comment for why. Never
     *  a client-supplied value; every real caller derives this from the
     *  platform's own financial records, never from a request body. */
    attributableCostAmount?: number;
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
    // Module 96 — a partner-deactivated link never generates a new
    // commission (see `SetReferralCodeActiveUseCase`'s own doc comment).
    // A conversion already in flight before deactivation still resolves
    // via `findByConversionEventId` above if it was already recorded —
    // this check only prevents new ones from a code the partner has
    // since turned off.
    if (!code.isActive) {
      return null;
    }

    const partner = await this.partners.findByUserId(code.ownerUserId);
    if (!partner || !isPartnerActiveForAffiliateActivity(partner.status)) {
      return null;
    }

    // Module 96 — self-referral HARD BLOCK (not advisory). A partner
    // referring their own already-registered account is the clearest
    // possible abuse signal (see `detectSelfReferral`'s own doc comment
    // in affiliate-fraud-rules.ts) — this is the one signal cheap and
    // unambiguous enough to check unconditionally at commission-creation
    // time, using only data this use case already has in hand (no new
    // invasive fingerprinting). The fraud/security event is still
    // recorded for admin auditability (`PartnerFraudFlagRepository`,
    // status OPEN — an admin can still review it), but — unlike every
    // other rule in affiliate-fraud-rules.ts — this one is never merely
    // advisory: no commission is ever created for it, and no fraud
    // signal is surfaced back to the partner (the caller only ever sees
    // `null`, identical to "no affiliate applies here" for any other
    // reason — see this class's own doc comment on why `null` is never
    // itself an error).
    if (attribution?.userId) {
      const selfReferralFindings = detectSelfReferral(partner.userId, [
        {
          referredUserId: attribution.userId,
          visitorId: input.visitorId,
          ipHash: null,
          userAgentTruncated: null,
          occurredAt: new Date(),
        },
      ]);
      if (selfReferralFindings.length > 0) {
        const finding = selfReferralFindings[0]!;
        if (this.fraudFlags) {
          await this.fraudFlags.create({
            partnerId: partner.id,
            type: finding.type,
            detail: finding.detail,
            relatedReferralCode: referralCode,
            relatedVisitorId: finding.relatedVisitorId,
            relatedUserId: finding.relatedUserId,
          });
        }
        logger.warn("affiliate.self_referral_blocked", {
          partnerId: partner.id,
          conversionEventId: input.conversionEventId,
        });
        return null;
      }
    }

    const now = new Date();
    const { profitBaseAmount, affiliateAmount } = calculateAffiliateCommission({
      platformCommissionAmount: input.platformCommissionAmount,
      attributableCostAmount: input.attributableCostAmount ?? 0,
    });

    return this.affiliateCommissions.create({
      partnerId: partner.id,
      referralCode,
      conversionEventId: input.conversionEventId,
      platformCommissionRefId: input.platformCommissionRefId,
      platformCommissionAmount: input.platformCommissionAmount,
      attributableCostAmount: input.attributableCostAmount ?? 0,
      profitBaseAmount,
      affiliateRateBps: AFFILIATE_COMMISSION_RATE_BPS,
      affiliateAmount,
      expiresAt: computeAffiliateCommissionExpiry(now),
    });
  }
}
