import type { JobNotifier } from "@/application/ports/job-notifier";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type {
  JobCancellationReasonValue,
  JobRecord,
  JobRepository,
} from "@/domain/repositories/job-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import { isCancellableStatus } from "@/domain/services/job-state";
import { resolveJobActor } from "./resolve-job-actor";

/**
 * Order / Job Lifecycle module (Module 11): either the customer or the
 * professional may cancel a Job that hasn't reached a terminal state yet
 * (CREATED or IN_PROGRESS — see job-state.ts), mirroring
 * CancelAppointmentUseCase's own "either party" authorization exactly.
 * Distinct from Appointment-level cancellation (Module 10's own concern) —
 * cancelling one Appointment does not cancel the Job; cancelling the Job
 * does not, in turn, cancel any of its Appointments (see the module's
 * audit report, "Appointment Integration" — Job never mutates Appointment
 * state).
 */
export class CancelJobUseCase {
  constructor(
    private readonly jobs: JobRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly notifier: JobNotifier,
  ) {}

  async execute(
    userId: string,
    jobId: string,
    reason: JobCancellationReasonValue,
    note: string | null,
  ): Promise<JobRecord> {
    const job = await this.jobs.findById(jobId);
    if (!job) {
      throw new NotFoundError("Job", jobId);
    }

    const actor = await resolveJobActor(userId, job, {
      customerProfiles: this.customerProfiles,
      professionals: this.professionals,
    });

    if (!isCancellableStatus(job.status)) {
      throw new ValidationError("This job can no longer be cancelled.");
    }

    // True compare-and-set: condition the write on the exact status this
    // call actually observed (`job.status`), not the whole non-terminal
    // category. CREATED and IN_PROGRESS are both legal *sequential*
    // starting points for a cancellation (see isCancellableStatus above,
    // and the module spec's requirement that a job remains cancellable
    // after it's been started) — but within a single call, only the
    // specific status this caller read is a valid precondition for *this*
    // write. Passing the broader NON_TERMINAL_STATUSES set here would let
    // this cancellation still succeed even after a concurrent startWork()
    // had already moved the job from CREATED to IN_PROGRESS underneath it
    // (both values being members of that broader set), which is exactly
    // the race this guard exists to prevent — see StartJobUseCase, which
    // already uses this same exact-status pattern (`expectedStatuses:
    // ["CREATED"]"`) for the same reason.
    const cancelled = await this.jobs.cancel({
      jobId,
      cancelledByUserId: userId,
      reason,
      note,
      expectedStatuses: [job.status],
    });

    try {
      await this.notifier.notify({
        serviceRequestId: job.serviceRequestId,
        professionalProfileId: job.professionalProfileId,
        companyProfileId: job.companyProfileId,
        type: "CANCELLED",
        actorUserId: userId,
        message:
          actor.role === "customer" ? "The customer cancelled this job." : "The professional cancelled this job.",
      });
    } catch (error) {
      console.error("Failed to post job-cancelled chat notice", error);
    }

    return cancelled;
  }
}
