import { NotFoundError } from "@/domain/errors/domain-error";
import type { PortfolioRepository } from "@/domain/repositories/portfolio-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";

/**
 * Deletes (soft-deletes) the *authenticated* professional's own
 * PortfolioItem. Ownership checked against the session's own
 * ProfessionalProfile, never a client-supplied professionalId — same
 * "not yours looks identical to doesn't exist" convention as
 * UpdatePortfolioItemUseCase/WithdrawQuoteUseCase.
 */
export class DeletePortfolioItemUseCase {
  constructor(
    private readonly portfolioItems: PortfolioRepository,
    private readonly professionals: ProfessionalRepository,
  ) {}

  async execute(userId: string, portfolioItemId: string): Promise<void> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional) {
      throw new NotFoundError("PortfolioItem", portfolioItemId);
    }

    const existing = await this.portfolioItems.findById(portfolioItemId);
    if (!existing || existing.professionalProfileId !== professional.id) {
      throw new NotFoundError("PortfolioItem", portfolioItemId);
    }

    await this.portfolioItems.softDelete(existing.id);
  }
}
