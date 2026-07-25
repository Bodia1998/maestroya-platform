import { NotFoundError } from "@/domain/errors/domain-error";
import type { DisputeRecord } from "@/domain/repositories/dispute-repository";
import type { JobRecord } from "@/domain/repositories/job-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";

export type DisputeActorRole = "customer" | "professional" | "company";

export interface DisputeActor {
  role: DisputeActorRole;
  userId: string;
}

/**
 * Module 21 — Disputes & Support: the single place every non-admin
 * Dispute-touching use case re-derives "is this authenticated user actually
 * a participant in this Dispute's underlying Job, and on which side" —
 * same role resolveJobActor plays for Job use cases (mirrors it verbatim
 * for the customer/professional cases), extended with company-membership
 * resolution (see this file's own "company" branch) since Dispute — unlike
 * plain Job use cases today — must support company-owned Jobs per the
 * module spec ("Company users access disputes for jobs their company
 * handles").
 *
 * `userId` always comes from the server-side session, ownership is always
 * re-derived from it (never trusted from a client-supplied id), and a
 * Dispute the caller has no relationship to surfaces as the same
 * NotFoundError as one that doesn't exist — never a distinguishable
 * "exists but isn't yours" response an attacker could use to probe for
 * valid Dispute ids (IDOR prevention — see the module spec's explicit
 * requirement).
 *
 * Admin access is NOT resolved here — admin-facing use cases
 * (GetAdminDisputeUseCase's callers, AssignDisputeUseCase, etc.) trust the
 * Server Action's `requireRole(ADMIN, SUPER_ADMIN, SUPPORT)` the same way
 * every existing admin use case trusts its `adminUserId` parameter (see
 * SuspendAdminUserUseCase's own doc comment) — this function only resolves
 * the two non-admin party roles.
 */
export async function resolveDisputeActor(
  userId: string,
  dispute: DisputeRecord,
  job: JobRecord,
  deps: {
    customerProfiles: CustomerProfileRepository;
    professionals: ProfessionalRepository;
    companyMembers: CompanyMembershipRepository;
  },
): Promise<DisputeActor> {
  const [customer, professional] = await Promise.all([
    deps.customerProfiles.findByUserId(userId),
    deps.professionals.findByUserId(userId),
  ]);

  if (customer && customer.id === job.customerId) {
    return { role: "customer", userId };
  }

  if (professional && job.professionalProfileId === professional.id) {
    return { role: "professional", userId };
  }

  if (job.companyProfileId) {
    const membership = await deps.companyMembers.findByCompanyAndUser(job.companyProfileId, userId);
    if (membership && membership.removedAt === null) {
      return { role: "company", userId };
    }
  }

  throw new NotFoundError("Dispute", dispute.id);
}
