import { NotFoundError } from "@/domain/errors/domain-error";
import { assertValidPartnerStatusTransition } from "@/domain/services/partner-approval-rules";
import type { PartnerRecord, PartnerRepository } from "@/domain/repositories/partner-repository";

/**
 * Module 61 — Affiliate & Partner System: admin action — suspends an
 * `APPROVED` partner (e.g. pending a fraud review — see
 * `DetectPartnerFraudSignalsUseCase`). Reversible: a suspended partner can
 * later be re-`APPROVED` (see `partner-approval-rules.ts`'s transition
 * table) or escalated to `BANNED`. Suspension does NOT itself cancel
 * already-`PENDING`/`APPROVED` affiliate commissions — that is a separate,
 * explicit admin action (`CancelAffiliateCommissionUseCase`) so a
 * temporary suspension for review never silently forfeits earnings an
 * investigation might later clear.
 */
export class SuspendPartnerUseCase {
  constructor(private readonly partners: PartnerRepository) {}

  async execute(input: { partnerId: string; adminUserId: string; reason: string }): Promise<PartnerRecord> {
    const partner = await this.partners.findById(input.partnerId);
    if (!partner) {
      throw new NotFoundError("Partner", input.partnerId);
    }

    assertValidPartnerStatusTransition(partner.status, "SUSPENDED");

    return this.partners.updateStatus(partner.id, {
      status: "SUSPENDED",
      suspendedAt: new Date(),
      suspendedReason: input.reason,
    });
  }
}
