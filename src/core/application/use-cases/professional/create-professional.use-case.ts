import { ConflictError, ValidationError } from "@/domain/errors/domain-error";
import type { ProfessionalRecord, ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ServiceCategoryRepository } from "@/domain/repositories/service-category-repository";
import type { CreateProfessionalInput } from "@/application/dto/professional.dto";

/**
 * Creates the ProfessionalProfile for the *authenticated* user — `userId`
 * must come from the server-side session (see rbac.ts requireAuth()),
 * never from client input, since this is what ties the new profile to a
 * specific account. One profile per user (ProfessionalProfile.userId is
 * unique in schema.prisma), so an existing profile is a conflict, not
 * something to silently overwrite.
 */
export class CreateProfessionalUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly categories: ServiceCategoryRepository,
  ) {}

  async execute(userId: string, input: CreateProfessionalInput): Promise<ProfessionalRecord> {
    const existing = await this.professionals.findByUserId(userId);
    if (existing) {
      throw new ConflictError("A professional profile already exists for this account.");
    }

    const categoryIds = await this.validateCategoryIds(input.categoryIds);

    return this.professionals.create(userId, {
      businessName: input.businessName || null,
      headline: input.headline || null,
      bio: input.bio || null,
      yearsExperience: input.yearsExperience ?? null,
      serviceRadiusKm: input.serviceRadiusKm ?? null,
      contactEmail: input.contactEmail || null,
      contactPhone: input.contactPhone || null,
      websiteUrl: input.websiteUrl || null,
      taxId: input.taxId || null,
      categoryIds,
    });
  }

  private async validateCategoryIds(categoryIds: string[] | undefined): Promise<string[]> {
    if (!categoryIds || categoryIds.length === 0) return [];
    const found = await this.categories.findActiveByIds(categoryIds);
    if (found.length !== new Set(categoryIds).size) {
      throw new ValidationError("One or more selected service categories are invalid.");
    }
    return categoryIds;
  }
}
