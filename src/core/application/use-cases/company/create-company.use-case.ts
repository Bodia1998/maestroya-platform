import { ConflictError, ValidationError } from "@/domain/errors/domain-error";
import type { CompanyRecord, CompanyRepository } from "@/domain/repositories/company-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import type { ServiceCategoryRepository } from "@/domain/repositories/service-category-repository";
import { slugify } from "@/domain/services/company-rules";
import type { CreateCompanyInput } from "@/application/dto/company.dto";

/**
 * Module 18 — Company Professional: creates a CompanyProfile owned by the
 * *authenticated* user (`userId` from the session, never client input) and
 * seeds the OWNER CompanyMember row in the same operation. A user may own
 * more than one company (no uniqueness constraint on ownerUserId — a person
 * running two separate businesses is a legitimate case, unlike
 * ProfessionalProfile.userId, which is 1:1 by design); a duplicate `taxId`
 * is still rejected as a conflict, matching ProfessionalProfile.taxId's own
 * uniqueness.
 */
export class CreateCompanyUseCase {
  constructor(
    private readonly companies: CompanyRepository,
    private readonly memberships: CompanyMembershipRepository,
    private readonly categories: ServiceCategoryRepository,
  ) {}

  async execute(userId: string, input: CreateCompanyInput): Promise<CompanyRecord> {
    const existingTaxId = await this.companies.findByTaxId(input.taxId.trim());
    if (existingTaxId) {
      throw new ConflictError("A company with this tax ID already exists.");
    }

    const categoryIds = await this.validateCategoryIds(input.categoryIds);
    const slug = await this.resolveUniqueSlug(input.tradeName || input.legalName);

    const company = await this.companies.create(userId, {
      legalName: input.legalName.trim(),
      tradeName: input.tradeName || null,
      taxId: input.taxId.trim(),
      description: input.description || null,
      logoUrl: input.logoUrl || null,
      websiteUrl: input.websiteUrl || null,
      slug,
      contactEmail: input.contactEmail || null,
      contactPhone: input.contactPhone || null,
      addressLine: input.addressLine || null,
      city: input.city || null,
      province: input.province || null,
      postalCode: input.postalCode || null,
      country: input.country || null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      categoryIds,
    });

    await this.memberships.createOwner(company.id, userId);

    return company;
  }

  private async validateCategoryIds(categoryIds: string[] | undefined): Promise<string[]> {
    if (!categoryIds || categoryIds.length === 0) return [];
    const found = await this.categories.findActiveByIds(categoryIds);
    if (found.length !== new Set(categoryIds).size) {
      throw new ValidationError("One or more selected service categories are invalid.");
    }
    return categoryIds;
  }

  private async resolveUniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || "company";
    let candidate = base;
    let suffix = 1;
    // Bounded loop — a company name colliding with more than 50 existing
    // slugs is not a realistic case; guards against an infinite loop rather
    // than modeling a real business rule.
    while ((await this.companies.existsBySlug(candidate)) && suffix <= 50) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }
}
