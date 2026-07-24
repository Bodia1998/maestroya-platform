import type {
  ListPortfolioItemsOptions,
  PortfolioItemRecord,
  PortfolioRepository,
} from "@/domain/repositories/portfolio-repository";

/**
 * Portfolio module (Module 14): public listing of a professional's
 * portfolio (their profile page) — no `requireAuth()` at the Server
 * Action/page boundary is required for this use case, mirroring
 * ListProfessionalReviewsUseCase's own doc comment (professional profiles
 * are publicly browsable in this product).
 *
 * `professionalProfileId` is accepted as-is — it identifies whose
 * portfolio to list, not a claim of ownership, same as
 * `revieweeProfessionalProfileId` elsewhere.
 *
 * Isolation: the repository's WHERE clause is always scoped to exactly one
 * professionalProfileId, so one professional's items never leak into
 * another's listing.
 *
 * Every field on PortfolioItemRecord is safe to expose publicly — there is
 * no separate "internal-only" field (no moderation status, no
 * owner-private notes), so this use case returns the same record shape a
 * future owner-facing dashboard listing would.
 */
export class ListPortfolioItemsUseCase {
  constructor(private readonly portfolioItems: PortfolioRepository) {}

  async execute(
    professionalProfileId: string,
    options: ListPortfolioItemsOptions,
  ): Promise<PortfolioItemRecord[]> {
    return this.portfolioItems.listByProfessionalId(professionalProfileId, options);
  }
}
