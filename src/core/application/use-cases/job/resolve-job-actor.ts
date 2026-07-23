import { NotFoundError } from "@/domain/errors/domain-error";
import type { JobRecord } from "@/domain/repositories/job-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";

export type JobActorRole = "customer" | "professional";

export interface JobActor {
  role: JobActorRole;
  userId: string;
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
 * Company-side ownership (Job.companyProfileId) is intentionally not
 * resolved here — same limitation resolveAppointmentActor already has for
 * Appointment.companyProfileId (this codebase only supports solo
 * professionals end-to-end today); a company-owned Job can only be acted
 * on by the customer side until a CompanyMember-aware resolution is added,
 * consistent with the existing convention rather than inventing new
 * company-membership behavior this module doesn't otherwise support.
 */
export async function resolveJobActor(
  userId: string,
  job: JobRecord,
  deps: {
    customerProfiles: CustomerProfileRepository;
    professionals: ProfessionalRepository;
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

  throw new NotFoundError("Job", job.id);
}
