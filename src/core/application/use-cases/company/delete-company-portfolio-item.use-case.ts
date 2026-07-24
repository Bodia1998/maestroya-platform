import { NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";
import type { PortfolioRepository } from "@/domain/repositories/portfolio-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { canManageCompanyProfile } from "@/domain/services/company-membership-rules";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

/** Module 18 — Company Professional (extends Module 14): owner/admin-only
 *  soft delete of a company portfolio item. An item belonging to a
 *  different company is rejected as NotFoundError. */
export class DeleteCompanyPortfolioItemUseCase {
  constructor(
    private readonly portfolioItems: PortfolioRepository,
    private readonly memberships: CompanyMembershipRepository,
  ) {}

  async execute(userId: string, companyId: string, itemId: string): Promise<void> {
    const actor = await resolveCompanyActor(userId, companyId, this.memberships);
    if (!canManageCompanyProfile(actor.role)) {
      throw new UnauthorizedError("Only a company owner or admin may manage the company's portfolio.");
    }

    const existing = await this.portfolioItems.findById(itemId);
    if (!existing || existing.companyProfileId !== companyId) {
      throw new NotFoundError("PortfolioItem", itemId);
    }

    await this.portfolioItems.softDelete(itemId);
  }
}
