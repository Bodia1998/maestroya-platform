import { NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import type { SelfBillingAuthorizationRecord, SelfBillingAuthorizationRepository } from "@/domain/repositories/self-billing-authorization-repository";
import { canManageCompanyProfile } from "@/domain/services/company-membership-rules";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

export interface GetMySelfBillingAuthorizationInput {
  userId: string;
  companyId?: string | null;
}

/**
 * Module 99 — Self-Billing Authorization Entry Point & Financial Document
 * Access.
 *
 * Read-only status lookup for the settings UI (§6/§11 of the decision
 * document) — "is my self-billing authorization currently ACTIVE." Same
 * ownership-resolution convention as `GrantMySelfBillingAuthorizationUseCase`/
 * `RevokeMySelfBillingAuthorizationUseCase`: never trusts a client-
 * supplied professionalProfileId/companyProfileId, always re-derives from
 * the authenticated `userId`. Returns `null` (not an error) when there is
 * no ACTIVE row — "not yet authorized" is a normal, displayable state, not
 * a failure.
 */
export class GetMySelfBillingAuthorizationUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly companyMembers: CompanyMembershipRepository,
    private readonly authorizations: SelfBillingAuthorizationRepository,
  ) {}

  async execute(input: GetMySelfBillingAuthorizationInput): Promise<SelfBillingAuthorizationRecord | null> {
    if (input.companyId) {
      const actor = await resolveCompanyActor(input.userId, input.companyId, this.companyMembers);
      if (!canManageCompanyProfile(actor.role)) {
        throw new UnauthorizedError("Only a company owner or admin may view the company's self-billing authorization status.");
      }
      return this.authorizations.findActiveForCompany(input.companyId);
    }

    const professional = await this.professionals.findByUserId(input.userId);
    if (!professional) {
      throw new NotFoundError("ProfessionalProfile", input.userId);
    }
    return this.authorizations.findActiveForProfessional(professional.id);
  }
}
