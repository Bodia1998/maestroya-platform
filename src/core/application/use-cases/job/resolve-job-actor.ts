import { NotFoundError } from "@/domain/errors/domain-error";
import type { JobRecord } from "@/domain/repositories/job-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { canActOnBehalfOfCompanyJob } from "@/domain/services/company-membership-rules";

export type JobActorRole = "customer" | "professional" | "company";

export interface JobActor {
  role: JobActorRole;
  userId: string;
  /** Only set when role === "company" — the caller's CompanyMember.id on
   *  the Job's owning company, for callers that need to attribute the
   *  action to a specific member (e.g. audit logging). */
  companyMemberId?: string;
}

/**
 * Order / Job Lifecycle module (Module 11): the single place every
 * Job-touching use case re-derives "is this authenticated user actually a
 * participant in this Job, and on which side" — shared rather than
 * duplicated per use case, same role this plays for Booking's
 * resolveAppointmentActor (see that file's own doc comment, which this
 * mirrors verbatim).
 *
 * `userId` always comes from the server-side session, ownership is always
 * re-derived from it (never trusted from a client-supplied customerId/
 * professionalProfileId), and a Job the caller has no relationship to
 * surfaces as the same NotFoundError as one that doesn't exist — never a
 * distinguishable "exists but isn't yours" response an attacker could use
 * to probe for valid Job ids.
 *
 * Company-side ownership (Job.companyProfileId): resolved only when the
 * caller supplies `deps.companyMembers` (Module 28 — Workflow Completion,
 * "Company Disputes" — see CreateDisputeUseCase, the first and so-far-only
 * caller that does). Every pre-existing caller of this function does not
 * pass `companyMembers` and is completely unaffected — the company branch
 * below is simply never reached for them, so their customer/professional
 * resolution behavior is unchanged byte-for-byte. This mirrors
 * resolveAppointmentActor's still-unresolved Appointment.companyProfileId
 * (Appointments remain out of scope for this — see
 * docs/MODULE_28_WORKFLOW_COMPLETION.md).
 *
 * A company member must additionally satisfy
 * `canActOnBehalfOfCompanyJob` (OWNER/ADMIN/MANAGER, not MEMBER — see that
 * predicate's own doc comment) to resolve as the "company" actor; a MEMBER
 * of the right company but the wrong role gets the same NotFoundError as
 * an unrelated user, not a distinguishable "forbidden" response.
 */
export async function resolveJobActor(
  userId: string,
  job: JobRecord,
  deps: {
    customerProfiles: CustomerProfileRepository;
    professionals: ProfessionalRepository;
    companyMembers?: CompanyMembershipRepository;
  },
): Promise<JobActor> {
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

  if (job.companyProfileId && deps.companyMembers) {
    const membership = await deps.companyMembers.findByCompanyAndUser(job.companyProfileId, userId);
    if (membership && membership.removedAt === null && canActOnBehalfOfCompanyJob(membership.role)) {
      return { role: "company", userId, companyMemberId: membership.id };
    }
  }

  throw new NotFoundError("Job", job.id);
}
