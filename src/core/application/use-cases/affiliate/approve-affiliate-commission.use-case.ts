import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AffiliateCommissionRecord, AffiliateCommissionRepository } from "@/domain/repositories/affiliate-commission-repository";

/**
 * Module 61 — Affiliate & Partner System: admin action — approves a
 * `PENDING` `AffiliateCommission`, making it eligible to be swept into a
 * payout by `CreatePartnerPayoutUseCase` (see
 * `domain/services/partner-payout-rules.ts`'s `selectPayoutBatch`, which
 * only ever selects `APPROVED` rows).
 */
export class ApproveAffiliateCommissionUseCase {
  constructor(private readonly affiliateCommissions: AffiliateCommissionRepository) {}

  async execute(id: string): Promise<AffiliateCommissionRecord> {
    const commission = await this.affiliateCommissions.findById(id);
    if (!commission) {
      throw new NotFoundError("AffiliateCommission", id);
    }
    if (commission.status !== "PENDING") {
      throw new ValidationError(`Only a PENDING affiliate commission can be approved (current status: "${commission.status}").`);
    }

    return this.affiliateCommissions.updateStatus(id, { status: "APPROVED", approvedAt: new Date() });
  }
}
