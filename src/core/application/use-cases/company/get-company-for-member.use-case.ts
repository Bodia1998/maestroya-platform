import { NotFoundError } from "@/domain/errors/domain-error";
import type { CompanyRecord, CompanyRepository } from "@/domain/repositories/company-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

/**
 * Module 18 — Company Professional: fetches a company's full internal
 * record for a caller who is an active member of it — the dashboard's own
 * "my company" view. Any active member (any role) may view it; only
 * OWNER/ADMIN may edit it (see UpdateCompanyUseCase). Not a member ⇒
 * NotFoundError, identical to "doesn't exist" (see resolveCompanyActor).
 */
export class GetCompanyForMemberUseCase {
  constructor(
    private readonly companies: CompanyRepository,
    private readonly memberships: CompanyMembershipRepository,
  ) {}

  async execute(userId: string, companyId: string): Promise<CompanyRecord> {
    await resolveCompanyActor(userId, companyId, this.memberships);
    const company = await this.companies.findById(companyId);
    if (!company) throw new NotFoundError("Company", companyId);
    return company;
  }
}
