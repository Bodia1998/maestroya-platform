import { NotFoundError } from "@/domain/errors/domain-error";
import { assertValidPartnerStatusTransition } from "@/domain/services/partner-approval-rules";
import type { PartnerRecord, PartnerRepository } from "@/domain/repositories/partner-repository";

/**
 * Module 61 — Affiliate & Partner System: admin action — rejects a
 * `PENDING` partner application. Terminal: a rejected applicant must
 * submit a brand-new application (a new `Partner` row is not created by
 * this module automatically; that is a product decision for whatever
 * front-end eventually calls `RegisterPartnerUseCase` again).
 */
export class RejectPartnerUseCase {
  constructor(private readonly partners: PartnerRepository) {}

  async execute(input: { partnerId: string; adminUserId: string; reason: string }): Promise<PartnerRecord> {
    const partner = await this.partners.findById(input.partnerId);
    if (!partner) {
      throw new NotFoundError("Partner", input.partnerId);
    }

    assertValidPartnerStatusTransition(partner.status, "REJECTED");

    return this.partners.updateStatus(partner.id, {
      status: "REJECTED",
      rejectedAt: new Date(),
      rejectedReason: input.reason,
    });
  }
}
