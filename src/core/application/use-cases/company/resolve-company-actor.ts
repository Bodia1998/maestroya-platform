import { NotFoundError } from "@/domain/errors/domain-error";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { deriveMembershipStatus, type CompanyMemberRoleValue } from "@/domain/services/company-membership-rules";

export interface CompanyActor {
  memberId: string;
  companyId: string;
  userId: string;
  role: CompanyMemberRoleValue;
}

/**
 * Module 18 — Company Professional: the single place every company-scoped
 * use case re-derives "is this authenticated user actually an active member
 * of this company, and with what role" — shared rather than duplicated,
 * same role resolveJobActor/resolveAppointmentActor play for their own
 * modules.
 *
 * `userId` always comes from the server-side session; a company the caller
 * has no active membership in surfaces as the same NotFoundError a
 * nonexistent company id would — never a distinguishable "exists but isn't
 * yours" response an attacker could use to probe for valid company ids
 * (same convention as Portfolio's "not yours looks identical to doesn't
 * exist").
 */
export async function resolveCompanyActor(
  userId: string,
  companyId: string,
  memberships: CompanyMembershipRepository,
): Promise<CompanyActor> {
  const member = await memberships.findByCompanyAndUser(companyId, userId);
  if (!member || deriveMembershipStatus(member) !== "ACTIVE") {
    throw new NotFoundError("Company", companyId);
  }
  return { memberId: member.id, companyId, userId, role: member.role };
}
