import { NotFoundError } from "@/domain/errors/domain-error";
import { assertValidPartnerStatusTransition } from "@/domain/services/partner-approval-rules";
import type { PartnerRecord, PartnerRepository } from "@/domain/repositories/partner-repository";

/**
 * Module 61 — Affiliate & Partner System: admin action — permanently bans
 * a partner (from `APPROVED` or `SUSPENDED`). Terminal — see
 * `partner-approval-rules.ts`'s transition table; there is no "unban" path
 * modeled by this module (see that file's own doc comment for why).
 * Deliberately does NOT cascade to cancel outstanding commissions/payouts
 * automatically — an admin reviewing a ban still needs to see what was
 * owed at the time, and cancellation (if warranted) is a distinct, audited
 * action via `CancelAffiliateCommissionUseCase`.
 */
export class BanPartnerUseCase {
  constructor(private readonly partners: PartnerRepository) {}

  async execute(input: { partnerId: string; adminUserId: string; reason: string }): Promise<PartnerRecord> {
    const partner = await this.partners.findById(input.partnerId);
    if (!partner) {
      throw new NotFoundError("Partner", input.partnerId);
    }

    assertValidPartnerStatusTransition(partner.status, "BANNED");

    return this.partners.updateStatus(partner.id, {
      status: "BANNED",
      bannedAt: new Date(),
      bannedReason: input.reason,
    });
  }
}
