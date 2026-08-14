import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { selectPayoutBatch } from "@/domain/services/partner-payout-rules";
import type { AffiliateCommissionRepository } from "@/domain/repositories/affiliate-commission-repository";
import type { PartnerPayoutRecord, PartnerPayoutRepository } from "@/domain/repositories/partner-payout-repository";
import type { PartnerRepository } from "@/domain/repositories/partner-repository";

/**
 * Module 61 — Affiliate & Partner System: admin action — settles a
 * partner's entire outstanding `APPROVED` balance into one `PartnerPayout`
 * batch, gated on `Partner.minimumPayoutThreshold` (see
 * `domain/services/partner-payout-rules.ts`). `method` is always the
 * partner's own configured `payoutMethod`; when that is `STRIPE`, this use
 * case still only records the payout row — no Stripe Connect transfer is
 * ever initiated here (see docs/MODULE_61's "Future Stripe support"
 * section: the architecture is prepared, not integrated).
 *
 * Marks every included commission `PAID` and stamps its `payoutId` in the
 * same operation (`AffiliateCommissionRepository.markPaidByIds`) so a
 * commission can never be selected into two different payouts.
 */
export class CreatePartnerPayoutUseCase {
  constructor(
    private readonly partners: PartnerRepository,
    private readonly affiliateCommissions: AffiliateCommissionRepository,
    private readonly payouts: PartnerPayoutRepository,
  ) {}

  async execute(input: { partnerId: string; periodStart: Date; periodEnd: Date }): Promise<PartnerPayoutRecord> {
    const partner = await this.partners.findById(input.partnerId);
    if (!partner) {
      throw new NotFoundError("Partner", input.partnerId);
    }

    const approved = await this.affiliateCommissions.listApprovedForPartner(input.partnerId);
    const batch = selectPayoutBatch(approved, partner.minimumPayoutThreshold);
    if (!batch) {
      throw new ValidationError(
        `Partner "${partner.id}" has not reached the minimum payout threshold of ${partner.minimumPayoutThreshold}.`,
      );
    }

    const payout = await this.payouts.create({
      partnerId: partner.id,
      amount: batch.amount,
      method: partner.payoutMethod,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    });

    await this.affiliateCommissions.markPaidByIds(batch.commissionIds, payout.id, new Date());

    return payout;
  }
}
