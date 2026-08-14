import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AffiliateCommissionRecord, AffiliateCommissionRepository } from "@/domain/repositories/affiliate-commission-repository";

/**
 * Module 61 — Affiliate & Partner System: admin action — cancels a
 * `PENDING` or `APPROVED` `AffiliateCommission` (e.g. a fraud
 * investigation confirmed the underlying conversion was fabricated — see
 * `PartnerFraudFlagRepository`). Never allowed once `PAID` — a paid
 * commission is settled; reversing it is an out-of-band financial
 * correction, not something this use case models (same reasoning
 * `CommissionRecord`'s own doc comment gives for corrections being a
 * `COMMISSION_REVERSAL` ledger entry, never a mutation of the original
 * row).
 */
export class CancelAffiliateCommissionUseCase {
  constructor(private readonly affiliateCommissions: AffiliateCommissionRepository) {}

  async execute(input: { id: string; reason: string }): Promise<AffiliateCommissionRecord> {
    const commission = await this.affiliateCommissions.findById(input.id);
    if (!commission) {
      throw new NotFoundError("AffiliateCommission", input.id);
    }
    if (commission.status !== "PENDING" && commission.status !== "APPROVED") {
      throw new ValidationError(
        `Only a PENDING or APPROVED affiliate commission can be cancelled (current status: "${commission.status}").`,
      );
    }

    return this.affiliateCommissions.updateStatus(input.id, {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelReason: input.reason,
    });
  }
}
