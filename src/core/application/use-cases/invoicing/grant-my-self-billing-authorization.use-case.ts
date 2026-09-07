import { NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import type { SelfBillingAuthorizationRecord } from "@/domain/repositories/self-billing-authorization-repository";
import { canManageCompanyProfile } from "@/domain/services/company-membership-rules";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";
import type { GrantSelfBillingAuthorizationUseCase } from "./grant-self-billing-authorization.use-case";

export interface GrantMySelfBillingAuthorizationInput {
  userId: string;
  /** Omit to grant as the caller's own solo ProfessionalProfile; supply to
   *  grant on behalf of a company the caller is a member of. */
  companyId?: string | null;
  agreementVersion: string;
  acceptanceIpAddress?: string | null;
  acceptanceUserAgent?: string | null;
}

/**
 * Module 99 — Self-Billing Authorization Entry Point & Financial Document
 * Access.
 *
 * The one thing the prior cross-module audit found missing end to end:
 * `GrantSelfBillingAuthorizationUseCase` (Module 79) existed, worked, and
 * was fully tested, but no production caller ever resolved "which
 * professional/company is this" from an authenticated session and invoked
 * it — see this file's own commit for the full finding. This use case is
 * that missing caller: it never accepts a client-supplied
 * professionalProfileId/companyProfileId (the exact "manipulate an
 * identifier belonging to another tenant" risk this module's brief warns
 * against) — ownership is always re-derived from `userId` (and, for the
 * company path, from `resolveCompanyActor`'s own membership lookup, the
 * same anti-IDOR convention every other company-scoped use case in this
 * codebase already uses).
 *
 * Never a second grant mechanism — this class performs no persistence of
 * its own; it resolves the caller's identity, checks the one company-side
 * permission the brief calls out explicitly (only OWNER/ADMIN may commit
 * a company to a billing/legal authorization — the same predicate
 * `CreateCompanyVerificationUseCase` already uses for the identical class
 * of decision, MANAGER excluded), and delegates entirely to the existing,
 * unmodified `GrantSelfBillingAuthorizationUseCase`.
 */
export class GrantMySelfBillingAuthorizationUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly companyMembers: CompanyMembershipRepository,
    private readonly grantAuthorization: GrantSelfBillingAuthorizationUseCase,
  ) {}

  async execute(input: GrantMySelfBillingAuthorizationInput): Promise<SelfBillingAuthorizationRecord> {
    if (input.companyId) {
      const actor = await resolveCompanyActor(input.userId, input.companyId, this.companyMembers);
      if (!canManageCompanyProfile(actor.role)) {
        throw new UnauthorizedError("Only a company owner or admin may grant self-billing authorization on behalf of the company.");
      }
      return this.grantAuthorization.execute({
        companyProfileId: input.companyId,
        agreementVersion: input.agreementVersion,
        acceptedByUserId: input.userId,
        acceptanceIpAddress: input.acceptanceIpAddress ?? null,
        acceptanceUserAgent: input.acceptanceUserAgent ?? null,
      });
    }

    const professional = await this.professionals.findByUserId(input.userId);
    if (!professional) {
      throw new NotFoundError("ProfessionalProfile", input.userId);
    }
    return this.grantAuthorization.execute({
      professionalProfileId: professional.id,
      agreementVersion: input.agreementVersion,
      acceptedByUserId: input.userId,
      acceptanceIpAddress: input.acceptanceIpAddress ?? null,
      acceptanceUserAgent: input.acceptanceUserAgent ?? null,
    });
  }
}
