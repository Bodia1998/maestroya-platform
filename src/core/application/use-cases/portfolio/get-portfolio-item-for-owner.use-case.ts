import { NotFoundError } from "@/domain/errors/domain-error";
import type { PortfolioItemRecord, PortfolioRepository } from "@/domain/repositories/portfolio-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";

/**
 * Fetches a single PortfolioItem for the *authenticated* professional who
 * owns it — e.g. to populate an edit form. Same ownership check and same
 * NotFoundError-for-"not yours" convention as
 * UpdatePortfolioItemUseCase/GetProfessionalQuoteUseCase: an item that
 * exists but belongs to another professional is indistinguishable from a
 * nonexistent one.
 *
 * Public/customer-facing reads of a professional's portfolio go through
 * ListPortfolioItemsUseCase instead, which requires no auth at all — see
 * that file's own doc comment.
 */
export class GetPortfolioItemForOwnerUseCase {
  constructor(
    private readonly portfolioItems: PortfolioRepository,
    private readonly professionals: ProfessionalRepository,
  ) {}

  async execute(userId: string, portfolioItemId: string): Promise<PortfolioItemRecord> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional) {
      throw new NotFoundError("PortfolioItem", portfolioItemId);
    }

    const existing = await this.portfolioItems.findById(portfolioItemId);
    if (!existing || existing.professionalProfileId !== professional.id) {
      throw new NotFoundError("PortfolioItem", portfolioItemId);
    }

    return existing;
  }
}
