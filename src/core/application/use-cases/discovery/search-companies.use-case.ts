import { ValidationError } from "@/domain/errors/domain-error";
import type { CompanyDiscoveryCandidate, CompanyDiscoveryRepository } from "@/domain/repositories/company-discovery-repository";
import type { ServiceCategoryRepository } from "@/domain/repositories/service-category-repository";
import type { SearchCompaniesInput } from "@/application/dto/company.dto";

export interface SearchCompaniesResult {
  results: CompanyDiscoveryCandidate[];
  total: number;
}

/**
 * Module 18 — Company Professional: finds companies for a customer's search
 * by category, integrating companies into Professional Discovery as a
 * distinct result type alongside SearchProfessionalsUseCase (see
 * docs/MODULE_18_COMPANY_PROFESSIONAL.md, "Discovery Integration") rather
 * than merging the two into one polymorphic result — this keeps each
 * search's own trust boundary and shape independent, and lets the calling
 * page render "Individual professionals" and "Companies" as separate
 * sections.
 *
 * Known limitation: unlike SearchProfessionalsUseCase, this has no
 * per-company geo-radius matching yet — CompanyProfile carries a location
 * (`latitude`/`longitude`/`city`/`province`) but no configured service
 * radius (a natural fit for the future Module 20 — Maps/Geolocation).
 * Every ACTIVE company offering the searched category is returned; a future
 * pass can add radius filtering the same way SearchProfessionalsUseCase
 * does once that field exists.
 */
export class SearchCompaniesUseCase {
  constructor(
    private readonly discovery: CompanyDiscoveryRepository,
    private readonly categories: ServiceCategoryRepository,
  ) {}

  async execute(input: SearchCompaniesInput): Promise<SearchCompaniesResult> {
    const [category] = await this.categories.findActiveByIds([input.categoryId]);
    if (!category) {
      throw new ValidationError("Select a valid, active service category.");
    }

    const candidates = await this.discovery.findActiveCandidatesByCategory(input.categoryId);
    candidates.sort((a, b) => (b.averageRating ?? 0) - (a.averageRating ?? 0));

    return { results: candidates, total: candidates.length };
  }
}
