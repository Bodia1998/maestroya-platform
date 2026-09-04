import { NotFoundError } from "@/domain/errors/domain-error";
import type { PartnerRepository } from "@/domain/repositories/partner-repository";
import type { ReferralCodeRepository } from "@/domain/repositories/referral-code-repository";
import type { ReferralVisitRepository } from "@/domain/repositories/referral-visit-repository";

/**
 * Module 96 — Referral & Affiliate Production Wiring: the partner
 * dashboard's "campaign management" listing — every referral link the
 * authenticated partner owns, each with its own visit count, so a partner
 * can see and manage (activate/deactivate) their own links without ever
 * touching another partner's data. `partnerId` is resolved by the caller
 * from the authenticated session, exactly like every other partner-facing
 * use case in this module (see `PartnerDashboardPage`'s own doc comment)
 * — there is no client-suppliable `ownerUserId`/`partnerId` filter here
 * that could leak across partners.
 */
export interface PartnerReferralLinkListItem {
  id: string;
  code: string;
  label: string | null;
  source: string | null;
  isActive: boolean;
  visits: number;
  createdAt: Date;
}

export class ListPartnerReferralCodesUseCase {
  constructor(
    private readonly partners: PartnerRepository,
    private readonly referralCodes: ReferralCodeRepository,
    private readonly visits: ReferralVisitRepository,
  ) {}

  async execute(partnerId: string): Promise<PartnerReferralLinkListItem[]> {
    const partner = await this.partners.findById(partnerId);
    if (!partner) {
      throw new NotFoundError("Partner", partnerId);
    }

    const codes = await this.referralCodes.findByOwnerUserId(partner.userId);
    const allVisits = await this.visits.listByReferralCodes(codes.map((c) => c.code));
    const visitCounts = new Map<string, number>();
    for (const v of allVisits) {
      if (!v.referralCode) continue;
      visitCounts.set(v.referralCode, (visitCounts.get(v.referralCode) ?? 0) + 1);
    }

    return codes.map((c) => ({
      id: c.id,
      code: c.code,
      label: c.label,
      source: c.source,
      isActive: c.isActive,
      visits: visitCounts.get(c.code) ?? 0,
      createdAt: c.createdAt,
    }));
  }
}
