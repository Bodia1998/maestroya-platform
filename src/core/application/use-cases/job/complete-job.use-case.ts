import type { JobNotifier } from "@/application/ports/job-notifier";
import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { JobRecord, JobRepository } from "@/domain/repositories/job-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import { isCompletableStatus } from "@/domain/services/job-state";
import { resolveJobActor } from "./resolve-job-actor";

/**
 * Order / Job Lifecycle module (Module 11): IN_PROGRESS -> COMPLETED — the
 * entire engagement is done, distinct from Appointment completion (one
 * visit is done — see CompleteAppointmentUseCase and job-state.ts's doc
 * comment on the two concepts).
 *
 * Professional/company side only (same restriction as StartJobUseCase —
 * see the module's audit report, "Authorization Model": a customer-side
 * completion-confirmation step is flagged there as a possible future
 * product decision, not assumed here since nothing in this codebase
 * currently implements two-sided completion for anything analogous).
 *
 * The actual "no non-terminal Appointment remains" guard is NOT
 * pre-checked here — it is enforced atomically inside
 * JobRepository.complete's own transaction (see that method's doc
 * comment), the same "the repository's own transaction is the
 * authoritative check" convention ConfirmAppointmentUseCase already uses
 * for its double-booking guard. This use case only handles authorization
 * and the per-Job-status precondition.
 */
export class CompleteJobUseCase {
  constructor(
    private readonly jobs: JobRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly notifier: JobNotifier,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
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
      throw new ValidationError("Only the professional can mark this job completed.");
    }

    if (!isCompletableStatus(job.status)) {
      throw new ValidationError("This job must be started before it can be completed.");
    }

    // JobRepository.complete throws ConflictError (not caught here) if any
    // Appointment on this Job is still non-terminal, or if a concurrent
    // change already moved the Job out of IN_PROGRESS — see its doc
    // comment. This use case never force-completes outstanding
    // Appointments; the caller must resolve or cancel every Appointment
    // first.
    const completed = await this.jobs.complete({
      jobId,
      completedByUserId: userId,
      expectedStatuses: ["IN_PROGRESS"],
    });

    try {
      await this.notifier.notify({
        serviceRequestId: job.serviceRequestId,
        professionalProfileId: job.professionalProfileId,
        companyProfileId: job.companyProfileId,
        type: "COMPLETED",
        actorUserId: userId,
        message: "The professional marked this job as completed.",
      });
    } catch (error) {
      console.error("Failed to post job-completed chat notice", error);
    }

    try {
      const customer = await this.customerProfiles.findById(job.customerId);
      if (customer) {
        await this.notifications.notify({
          userId: customer.userId,
          type: "JOB_COMPLETED",
          title: "Job completed",
          message: "The professional marked your job as completed.",
          resourceType: "JOB",
          resourceId: job.id,
          actionUrl: `/jobs/${job.id}`,
        });
      }
    } catch (error) {
      console.error("Failed to create job-completed notification", error);
    }

    return completed;
  }
}
