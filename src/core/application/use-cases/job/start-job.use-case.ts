import type { JobNotifier } from "@/application/ports/job-notifier";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { JobRecord, JobRepository } from "@/domain/repositories/job-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import { isStartableStatus } from "@/domain/services/job-state";
import { resolveJobActor } from "./resolve-job-actor";

/**
 * Order / Job Lifecycle module (Module 11): CREATED -> IN_PROGRESS. The
 * explicit "start work" action recommended by the module's audit report
 * (Section 6, Option B) — deliberately independent of Appointment
 * confirmation, so a professional has a clean moment to signal "I am now
 * on-site / working" that doesn't depend on Module 10's own scheduling
 * mechanics.
 *
 * Professional/company side only — a customer cannot start their own Job
 * (see the module's audit report, "Authorization Model"). A customer who
 * is a legitimate participant in this Job but attempts to start it gets a
 * ValidationError (a real business-rule rejection, since they ARE
 * authorized to know this Job exists) — never the NotFoundError
 * resolveJobActor reserves for callers with no relationship to the Job at
 * all.
 */
export class StartJobUseCase {
  constructor(
    private readonly jobs: JobRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly notifier: JobNotifier,
  ) {}

  async execute(userId: string, jobId: string): Promise<JobRecord> {
    const job = await this.jobs.findById(jobId);
    if (!job) {
      throw new NotFoundError("Job", jobId);
    }

    const actor = await resolveJobActor(userId, job, {
      customerProfiles: this.customerProfiles,
      professionals: this.professionals,
    });
    if (actor.role !== "professional") {
      throw new ValidationError("Only the professional can start this job.");
    }

    if (!isStartableStatus(job.status)) {
      throw new ValidationError("This job can no longer be started.");
    }

    const started = await this.jobs.startWork({
      jobId,
      startedByUserId: userId,
      expectedStatuses: ["CREATED"],
    });

    try {
      await this.notifier.notify({
        serviceRequestId: job.serviceRequestId,
        professionalProfileId: job.professionalProfileId,
        companyProfileId: job.companyProfileId,
        type: "STARTED",
        actorUserId: userId,
        message: "The professional started work on this job.",
      });
    } catch (error) {
      console.error("Failed to post job-started chat notice", error);
    }

    return started;
  }
}
