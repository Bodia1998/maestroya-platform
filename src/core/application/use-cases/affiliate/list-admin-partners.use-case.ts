import type { PartnerRecord, PartnerRepository, PartnerStatusValue } from "@/domain/repositories/partner-repository";

/**
 * Module 61 — Affiliate & Partner System: admin-panel listing — every
 * partner, optionally filtered by status (e.g. the "pending approvals"
 * queue). Thin pass-through over `PartnerRepository.list`; kept as its own
 * use case (rather than an admin Server Action calling the repository
 * directly) so authorization/composition stays consistent with every other
 * admin listing use case in this codebase (e.g. `ListAdminDisputesUseCase`).
 */
export class ListAdminPartnersUseCase {
  constructor(private readonly partners: PartnerRepository) {}

  async execute(filter?: { status?: PartnerStatusValue }): Promise<PartnerRecord[]> {
    return this.partners.list(filter);
  }
}
