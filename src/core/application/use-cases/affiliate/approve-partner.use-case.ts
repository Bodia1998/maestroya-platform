import { NotFoundError } from "@/domain/errors/domain-error";
import { assertValidPartnerStatusTransition } from "@/domain/services/partner-approval-rules";
import type { PartnerRecord, PartnerRepository } from "@/domain/repositories/partner-repository";

/**
 * Module 61 — Affiliate & Partner System: admin action — approves a
 * `PENDING` (or previously `SUSPENDED`) partner, unlocking referral-link
 * generation and affiliate-commission accrual (see
 * `isPartnerActiveForAffiliateActivity`). The lifecycle check itself lives
 * in `partner-approval-rules.ts`; this use case only orchestrates the
 * lookup + persistence around it.
 */
export class ApprovePartnerUseCase {
  constructor(private readonly partners: PartnerRepository) {}

  async execute(input: { partnerId: string; adminUserId: string }): Promise<PartnerRecord> {
    const partner = await this.partners.findById(input.partnerId);
    if (!partner) {
      throw new NotFoundError("Partner", input.partnerId);
    }

    assertValidPartnerStatusTransition(partner.status, "APPROVED");

    return this.partners.updateStatus(partner.id, {
      status: "APPROVED",
      approvedAt: new Date(),
      approvedByUserId: input.adminUserId,
    });
  }
}
