import { UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import type { PortfolioItemRecord, PortfolioRepository } from "@/domain/repositories/portfolio-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import type { ServiceCategoryRepository } from "@/domain/repositories/service-category-repository";
import { canManageCompanyProfile } from "@/domain/services/company-membership-rules";
import { isValidDescription, isValidMediaUrl, isValidTitle, normalizeOptionalText } from "@/domain/services/portfolio-rules";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

export interface CreateCompanyPortfolioItemInput {
  title: string;
  description: string | null;
  mediaUrl: string;
  serviceCategoryId: string | null;
}

/** Module 18 — Company Professional (extends Module 14): creates a
 *  portfolio item owned by a CompanyProfile instead of a
 *  ProfessionalProfile — same validation rules (portfolio-rules.ts, reused
 *  as-is), OWNER/ADMIN-only authorization (canManageCompanyProfile). */
export class CreateCompanyPortfolioItemUseCase {
  constructor(
    private readonly portfolioItems: PortfolioRepository,
    private readonly memberships: CompanyMembershipRepository,
    private readonly categories: ServiceCategoryRepository,
  ) {}

  async execute(userId: string, companyId: string, input: CreateCompanyPortfolioItemInput): Promise<PortfolioItemRecord> {
    const actor = await resolveCompanyActor(userId, companyId, this.memberships);
    if (!canManageCompanyProfile(actor.role)) {
      throw new UnauthorizedError("Only a company owner or admin may manage the company's portfolio.");
    }

    if (!isValidTitle(input.title)) throw new ValidationError("Title must be between 3 and 120 characters.");
    if (!isValidDescription(input.description)) throw new ValidationError("Description must be 2000 characters or fewer.");
    if (!isValidMediaUrl(input.mediaUrl)) throw new ValidationError("Media URL must be a valid http(s) URL.");

    let serviceCategoryId: string | null = null;
    if (input.serviceCategoryId) {
      const found = await this.categories.findActiveByIds([input.serviceCategoryId]);
      if (found.length === 0) throw new ValidationError("Selected service category is invalid.");
      serviceCategoryId = input.serviceCategoryId;
    }

    return this.portfolioItems.create({
      companyProfileId: companyId,
      serviceCategoryId,
      title: input.title.trim(),
      description: normalizeOptionalText(input.description),
      mediaUrl: input.mediaUrl.trim(),
    });
  }
}
