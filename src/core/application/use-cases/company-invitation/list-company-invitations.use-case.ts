import { UnauthorizedError } from "@/domain/errors/domain-error";
import type { CompanyInvitationRecord, CompanyInvitationRepository } from "@/domain/repositories/company-invitation-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { canInviteMembers } from "@/domain/services/company-membership-rules";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

/** Module 18 — Company Professional: lists every invitation (any status)
 *  for a company's invitations-management page. OWNER/ADMIN only — same
 *  authorization as creating/cancelling invitations. */
export class ListCompanyInvitationsUseCase {
  constructor(
    private readonly invitations: CompanyInvitationRepository,
    private readonly memberships: CompanyMembershipRepository,
  ) {}

  async execute(userId: string, companyId: string): Promise<CompanyInvitationRecord[]> {
    const actor = await resolveCompanyActor(userId, companyId, this.memberships);
    if (!canInviteMembers(actor.role)) {
      throw new UnauthorizedError("Only a company owner or admin may view invitations.");
    }
    return this.invitations.listByCompany(companyId);
  }
}
