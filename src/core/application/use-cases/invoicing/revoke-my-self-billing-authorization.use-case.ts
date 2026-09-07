import { NotFoundError, UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import type { SelfBillingAuthorizationRecord, SelfBillingAuthorizationRepository } from "@/domain/repositories/self-billing-authorization-repository";
import { canManageCompanyProfile } from "@/domain/services/company-membership-rules";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";
import type { RevokeSelfBillingAuthorizationUseCase } from "./revoke-self-billing-authorization.use-case";

export interface RevokeMySelfBillingAuthorizationInput {
  userId: string;
  /** Omit to revoke the caller's own solo-professional authorization;
   *  supply to revoke a company's authorization. */
  companyId?: string | null;
}

/**
 * Module 99 — Self-Billing Authorization Entry Point & Financial Document
 * Access.
 *
 * Deliberately does NOT accept a client-supplied `authorizationId` —
 * `RevokeSelfBillingAuthorizationUseCase.execute(authorizationId,
 * revokedByUserId)` (Module 79) revokes whatever row `authorizationId`
 * names and records `revokedByUserId` purely as an audit field; it never
 * cross-checks that the caller actually owns that row (confirmed by
 * reading `PrismaSelfBillingAuthorizationRepository.revoke` — its `WHERE`
 * clause matches on `id` alone). Exposing that use case directly to a
 * client-supplied id would let any authenticated professional revoke any
 * other professional's or company's authorization by guessing/enumerating
 * a UUID — exactly the IDOR class this module's brief prohibits.
 *
 * This use case closes that gap the same way `AcceptInvoiceUseCase`
 * already closes an analogous one for invoices: it never trusts an
 * identifier the client supplies. Instead it resolves the caller's own
 * professional/company identity from the authenticated `userId` (and,
 * for the company path, `resolveCompanyActor`'s membership-role check,
 * OWNER/ADMIN only — same predicate `GrantMySelfBillingAuthorizationUseCase`
 * uses for the mirror-image operation), looks up THAT party's own
 * currently-ACTIVE authorization via the existing
 * `findActiveForProfessional`/`findActiveForCompany` methods, and only
 * then calls the existing, unmodified `RevokeSelfBillingAuthorizationUseCase`
 * with the id it just resolved server-side — never one a client provided.
 */
export class RevokeMySelfBillingAuthorizationUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly companyMembers: CompanyMembershipRepository,
    private readonly authorizations: SelfBillingAuthorizationRepository,
    private readonly revokeAuthorization: RevokeSelfBillingAuthorizationUseCase,
  ) {}

  async execute(input: RevokeMySelfBillingAuthorizationInput): Promise<SelfBillingAuthorizationRecord> {
    if (input.companyId) {
      const actor = await resolveCompanyActor(input.userId, input.companyId, this.companyMembers);
      if (!canManageCompanyProfile(actor.role)) {
        throw new UnauthorizedError("Only a company owner or admin may revoke self-billing authorization on behalf of the company.");
      }
      const active = await this.authorizations.findActiveForCompany(input.companyId);
      if (!active) {
        throw new ValidationError("This company has no active self-billing authorization to revoke.");
      }
      return this.revokeAuthorization.execute(active.id, input.userId);
    }

    const professional = await this.professionals.findByUserId(input.userId);
    if (!professional) {
      throw new NotFoundError("ProfessionalProfile", input.userId);
    }
    const active = await this.authorizations.findActiveForProfessional(professional.id);
    if (!active) {
      throw new ValidationError("You have no active self-billing authorization to revoke.");
    }
    return this.revokeAuthorization.execute(active.id, input.userId);
  }
}
