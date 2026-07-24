import { UnauthorizedError } from "@/domain/errors/domain-error";
import type { CompanyRecord, CompanyRepository } from "@/domain/repositories/company-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { canManageCompanyProfile } from "@/domain/services/company-membership-rules";
import type { UpdateCompanyInput } from "@/application/dto/company.dto";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

/**
 * Module 18 — Company Professional: updates a company's own profile fields.
 * Only OWNER/ADMIN members may edit it (see canManageCompanyProfile) — a
 * MANAGER/MEMBER caller is rejected with UnauthorizedError even though they
 * *are* a member (distinct from "not a member at all", which is
 * NotFoundError — see resolveCompanyActor).
 */
export class UpdateCompanyUseCase {
  constructor(
    private readonly companies: CompanyRepository,
    private readonly memberships: CompanyMembershipRepository,
  ) {}

  async execute(userId: string, companyId: string, input: UpdateCompanyInput): Promise<CompanyRecord> {
    const actor = await resolveCompanyActor(userId, companyId, this.memberships);
    if (!canManageCompanyProfile(actor.role)) {
      throw new UnauthorizedError("Only a company owner or admin may edit the company profile.");
    }

    return this.companies.update(companyId, {
      legalName: input.legalName?.trim(),
      tradeName: input.tradeName || null,
      description: input.description || null,
      logoUrl: input.logoUrl || null,
      websiteUrl: input.websiteUrl || null,
      contactEmail: input.contactEmail || null,
      contactPhone: input.contactPhone || null,
      addressLine: input.addressLine || null,
      city: input.city || null,
      province: input.province || null,
      postalCode: input.postalCode || null,
      country: input.country || null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      isAcceptingRequests: input.isAcceptingRequests,
    });
  }
}
