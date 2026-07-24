import type { CompanyMemberWithUser, CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

/** Module 18 — Company Professional: lists every member (including pending
 *  invitees) of a company for its members-management page. Any active
 *  member may view the list — visibility of team membership is internal
 *  company data, not owner/admin-only, but never exposed publicly (see
 *  CompanyDiscoveryRepository, which only exposes a `teamSize` count). */
export class ListCompanyMembersUseCase {
  constructor(private readonly memberships: CompanyMembershipRepository) {}

  async execute(userId: string, companyId: string): Promise<CompanyMemberWithUser[]> {
    await resolveCompanyActor(userId, companyId, this.memberships);
    return this.memberships.listByCompany(companyId);
  }
}
