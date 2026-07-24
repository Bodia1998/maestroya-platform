import { ValidationError } from "@/domain/errors/domain-error";
import type { PortfolioItemRecord, PortfolioRepository } from "@/domain/repositories/portfolio-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ServiceCategoryRepository } from "@/domain/repositories/service-category-repository";
import { isValidMediaUrl, isValidTitle, isValidDescription, normalizeOptionalText } from "@/domain/services/portfolio-rules";

export interface CreatePortfolioItemInput {
  title: string;
  description: string | null;
  mediaUrl: string;
  serviceCategoryId: string | null;
}

/**
 * Creates a PortfolioItem for the *authenticated* professional. `userId`
 * must come from the server-side session — the owning ProfessionalProfile
 * is always looked up by that userId (never a client-supplied
 * professionalId), so a client can never create a portfolio item for
 * someone else's profile. Same "resolve the actor from the session, then
 * act on their own record" convention as CreateQuoteUseCase.
 *
 * Only an ACTIVE professional profile can add portfolio items — same rule
 * CreateQuoteUseCase enforces, and same ValidationError message shape, so
 * a customer (who has no ProfessionalProfile at all) and a
 * suspended/inactive professional are rejected identically.
 */
export class CreatePortfolioItemUseCase {
  constructor(
    private readonly portfolioItems: PortfolioRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly categories: ServiceCategoryRepository,
  ) {}

  async execute(userId: string, input: CreatePortfolioItemInput): Promise<PortfolioItemRecord> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional || professional.status !== "ACTIVE") {
      throw new ValidationError("You must have an active professional profile to manage your portfolio.");
    }

    // Defense in depth: the Server Action's DTO (createPortfolioItemSchema)
    // already validates these, but the use case is also callable directly
    // (as every test in this codebase does), so the rules are re-checked
    // here too — same "domain rule enforced at both the DTO boundary and
    // the use case" convention as CreateReviewUseCase.
    if (!isValidTitle(input.title)) {
      throw new ValidationError("Title must be between 3 and 120 characters.");
    }
    if (!isValidDescription(input.description)) {
      throw new ValidationError("Description must be 2000 characters or fewer.");
    }
    if (!isValidMediaUrl(input.mediaUrl)) {
      throw new ValidationError("Media URL must be a valid http(s) URL.");
    }

    const serviceCategoryId = await this.resolveServiceCategoryId(input.serviceCategoryId);

    return this.portfolioItems.create({
      professionalProfileId: professional.id,
      serviceCategoryId,
      title: input.title.trim(),
      description: normalizeOptionalText(input.description),
      mediaUrl: input.mediaUrl.trim(),
    });
  }

  private async resolveServiceCategoryId(serviceCategoryId: string | null): Promise<string | null> {
    if (!serviceCategoryId) return null;
    const found = await this.categories.findActiveByIds([serviceCategoryId]);
    if (found.length === 0) {
      throw new ValidationError("Selected service category is invalid.");
    }
    return serviceCategoryId;
  }
}
