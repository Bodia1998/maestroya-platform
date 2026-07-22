import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { ProfessionalRecord, ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ServiceCategoryRepository } from "@/domain/repositories/service-category-repository";
import type { UpdateProfessionalServicesInput } from "@/application/dto/professional.dto";

/**
 * Replaces the *authenticated* user's own professional profile's set of
 * service categories. Looked up by session userId, never a client-
 * supplied professionalId. Every submitted category id is re-validated
 * against ServiceCategoryRepository — the client only sends ids, and an
 * id for a deleted/archived/nonexistent category must not be trusted.
 */
export class UpdateProfessionalServicesUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly categories: ServiceCategoryRepository,
  ) {}

  async execute(userId: string, input: UpdateProfessionalServicesInput): Promise<ProfessionalRecord> {
    const existing = await this.professionals.findByUserId(userId);
    if (!existing) {
      throw new NotFoundError("ProfessionalProfile", userId);
    }

    const uniqueIds = [...new Set(input.categoryIds)];
    const found = await this.categories.findActiveByIds(uniqueIds);
    if (found.length !== uniqueIds.length) {
      throw new ValidationError("One or more selected service categories are invalid.");
    }

    return this.professionals.updateCategories(existing.id, uniqueIds);
  }
}
