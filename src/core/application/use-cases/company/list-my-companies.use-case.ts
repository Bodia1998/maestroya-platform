import type { CompanyRecord, CompanyRepository } from "@/domain/repositories/company-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";

/**
 * Module 18 — Company Professional: every company the authenticated user
 * currently has an active membership in — backs the company-context
 * selector (Section 17 of the module brief). A user may belong to more
 * than one company; this never assumes exactly one.
 */
export class ListMyCompaniesUseCase {
  constructor(
    private readonly companies: CompanyRepository,
    private readonly memberships: CompanyMembershipRepository,
  ) {}

  async execute(userId: string): Promise<CompanyRecord[]> {
    const memberRows = await this.memberships.listActiveCompaniesForUser(userId);
    const companies = await Promise.all(memberRows.map((m) => this.companies.findById(m.companyId)));
    return companies.filter((c): c is CompanyRecord => c !== null);
  }
}
