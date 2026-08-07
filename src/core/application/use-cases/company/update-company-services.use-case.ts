import { UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import { CompanyUpdated } from "@/domain/events/company-updated";
import type { CompanyRecord, CompanyRepository } from "@/domain/repositories/company-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import type { ServiceCategoryRepository } from "@/domain/repositories/service-category-repository";
import { canManageCompanyProfile } from "@/domain/services/company-membership-rules";
import type { UpdateCompanyServicesInput } from "@/application/dto/company.dto";
import type { EventBus } from "@/application/ports/event-bus";
import { NullEventBus } from "@/application/ports/null-event-bus";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

/** Module 18 — Company Professional: replaces the company's service
 *  category set. Same OWNER/ADMIN-only authorization as UpdateCompanyUseCase. */
export class UpdateCompanyServicesUseCase {
  constructor(
    private readonly companies: CompanyRepository,
    private readonly memberships: CompanyMembershipRepository,
    private readonly categories: ServiceCategoryRepository,
    /** Module 47 — CQRS Search Engine: trailing/defaulted, see `CreateProfessionalUseCase`. */
    private readonly eventBus: EventBus = new NullEventBus(),
  ) {}

  async execute(userId: string, companyId: string, input: UpdateCompanyServicesInput): Promise<CompanyRecord> {
    const actor = await resolveCompanyActor(userId, companyId, this.memberships);
    if (!canManageCompanyProfile(actor.role)) {
      throw new UnauthorizedError("Only a company owner or admin may edit the company's services.");
    }

    const found = await this.categories.findActiveByIds(input.categoryIds);
    if (found.length !== new Set(input.categoryIds).size) {
      throw new ValidationError("One or more selected service categories are invalid.");
    }

    const company = await this.companies.updateCategories(companyId, input.categoryIds);

    await publishDomainEvent(this.eventBus, new CompanyUpdated(companyId, "categories"));

    return company;
  }
}
