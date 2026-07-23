import { NotFoundError } from "@/domain/errors/domain-error";
import type { JobRecord, JobRepository } from "@/domain/repositories/job-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { JobActorRole } from "./resolve-job-actor";
import { resolveJobActor } from "./resolve-job-actor";

export interface GetJobResult {
  job: JobRecord;
  /** Which side of this Job the caller is — the UI uses this to decide
   *  which actions (start/complete are professional-only, see
   *  StartJobUseCase/CompleteJobUseCase) to render, without re-deriving
   *  ownership itself. Every action is still re-validated server-side by
   *  its own use case regardless of what the UI decides to show. */
  viewerRole: JobActorRole;
}

/**
 * Order / Job Lifecycle module (Module 11): fetches one Job's full detail
 * for its detail page, authorized the same way every other Job use case is
 * — see resolveJobActor's doc comment. Mirrors GetAppointmentUseCase, with
 * one addition (`viewerRole`) since, unlike Appointment's detail page, the
 * Job detail page needs to know which side the caller is on to decide
 * which actions to render (start/complete are professional-only).
 */
export class GetJobUseCase {
  constructor(
    private readonly jobs: JobRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
  ) {}

  async execute(userId: string, jobId: string): Promise<GetJobResult> {
    const job = await this.jobs.findById(jobId);
    if (!job) {
      throw new NotFoundError("Job", jobId);
    }

    const actor = await resolveJobActor(userId, job, {
      customerProfiles: this.customerProfiles,
      professionals: this.professionals,
    });

    return { job, viewerRole: actor.role };
  }
}
