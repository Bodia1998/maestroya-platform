import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { PortfolioItemRecord, PortfolioRepository } from "@/domain/repositories/portfolio-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ServiceCategoryRepository } from "@/domain/repositories/service-category-repository";
import { isValidMediaUrl, isValidTitle, isValidDescription, normalizeOptionalText } from "@/domain/services/portfolio-rules";

export interface UpdatePortfolioItemInput {
  title: string;
  description: string | null;
  mediaUrl: string;
  serviceCategoryId: string | null;
}

/**
 * Updates the *authenticated* professional's own PortfolioItem — looked up
 * by portfolioItemId, but ownership is always checked against the
 * session's own ProfessionalProfile, never trusted from the client. Same
 * "not yours looks identical to doesn't exist" convention as
 * UpdateQuoteUseCase/WithdrawQuoteUseCase: an item that exists but belongs
 * to another professional throws the exact same NotFoundError a
 * nonexistent id would, so no request can be used to probe which
 * portfolio-item ids belong to which professional.
 *
 * `professionalProfileId` can never be changed through this use case —
 * UpdatePortfolioItemInput/UpdatePortfolioItemData have no field for it.
 */
export class UpdatePortfolioItemUseCase {
  constructor(
    private readonly portfolioItems: PortfolioRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly categories: ServiceCategoryRepository,
  ) {}

  async execute(userId: string, portfolioItemId: string, input: UpdatePortfolioItemInput): Promise<PortfolioItemRecord> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional) {
      throw new NotFoundError("PortfolioItem", portfolioItemId);
    }

    const existing = await this.portfolioItems.findById(portfolioItemId);
    if (!existing || existing.professionalProfileId !== professional.id) {
      throw new NotFoundError("PortfolioItem", portfolioItemId);
    }

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

    return this.portfolioItems.update(existing.id, {
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
