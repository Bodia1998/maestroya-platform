import { NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";
import type { PartnerRepository } from "@/domain/repositories/partner-repository";
import type { ReferralCodeRepository } from "@/domain/repositories/referral-code-repository";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 96 — Referral & Affiliate Production Wiring: lets a partner
 * activate/deactivate one of their own referral links (campaign
 * management). Ownership is re-checked against the *authenticated
 * partner's own* `partnerId` on every call — a partner can never toggle a
 * code they don't own, even by guessing another partner's code id (an
 * IDOR this use case exists specifically to close off; see
 * `ReferralCodeRepository.setActive`'s own doc comment for why the
 * repository method itself is not a safe standalone existence check).
 *
 * Deactivating a code is forward-looking only: it stops
 * `RecordAffiliateCommissionUseCase` from creating new commissions
 * through it, but never rewrites history — existing commissions, visits
 * and attribution rows for that code are untouched, and the link still
 * redirects a visitor (see `/r/[code]`'s own doc comment on why a broken
 * link must never be the result of a partner's own dashboard action).
 */
export class SetReferralCodeActiveUseCase {
  constructor(
    private readonly partners: PartnerRepository,
    private readonly referralCodes: ReferralCodeRepository,
  ) {}

  async execute(input: { partnerId: string; referralCodeId: string; isActive: boolean }): Promise<void> {
    const partner = await this.partners.findById(input.partnerId);
    if (!partner) {
      throw new NotFoundError("Partner", input.partnerId);
    }

    const code = await this.referralCodes.findById(input.referralCodeId);
    if (!code) {
      throw new NotFoundError("ReferralCode", input.referralCodeId);
    }
    if (code.ownerUserId !== partner.userId) {
      throw new UnauthorizedError("This referral link does not belong to your partner account.");
    }

    await this.referralCodes.setActive(code.id, input.isActive);
    logger.info("affiliate.referral_link.active_toggled", {
      partnerId: partner.id,
      referralCodeId: code.id,
      isActive: input.isActive,
    });
  }
}
