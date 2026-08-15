import type { JobNotifier } from "@/application/ports/job-notifier";
import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { JobRecord, JobRepository } from "@/domain/repositories/job-repository";
import type { JobCompletionConfirmationRepository } from "@/domain/repositories/job-completion-confirmation-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import { isCompletableStatus } from "@/domain/services/job-state";
import { resolveJobActor } from "./resolve-job-actor";
import { ProfessionalCompletedJob } from "@/domain/events/professional-completed-job";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/**
 * Order / Job Lifecycle module (Module 11), extended by Module 66 — Job
 * Completion & Payment Release Protection: IN_PROGRESS -> COMPLETED — the
 * entire engagement is done, distinct from Appointment completion (one
 * visit is done — see CompleteAppointmentUseCase and job-state.ts's doc
 * comment on the two concepts).
 *
 * Professional/company side only — completion alone was already
 * restricted to this side before Module 66 (see StartJobUseCase's own
 * restriction). Module 66's own change: this action NEVER releases
 * payment by itself. `JobRepository.complete`'s own transaction now also
 * creates a `JobCompletionConfirmation` row (WAITING_FOR_CUSTOMER) — see
 * that method's doc comment — so the moment this Job becomes COMPLETED,
 * its payment is *already* protected behind the customer-confirmation
 * gate; there is no window where COMPLETED exists without that
 * protection. This use case's own job, beyond authorization, is now also
 * to announce that fact (`ProfessionalCompletedJob`, and the
 * confirmation-required customer notification below) — it still performs
 * no release logic itself, which lives entirely in
 * `EvaluatePaymentReleaseUseCase`/`payment-release-decision.ts`.
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
    private readonly confirmations?: JobCompletionConfirmationRepository,
    private readonly eventBus?: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
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
        // Module 66: the message is deliberately explicit that a
        // confirmation step follows — "job completed" alone would wrongly
        // imply the engagement (and its payment) is already fully
        // settled from the customer's perspective.
        await this.notifications.notify({
          userId: customer.userId,
          type: "JOB_COMPLETION_CONFIRMATION_REQUESTED",
          title: "Please confirm your completed service",
          message: "The professional marked your job as completed. Please confirm the work was done, or let us know if there's a problem.",
          resourceType: "JOB",
          resourceId: job.id,
          actionUrl: `/jobs/${job.id}`,
        });
      }
    } catch (error) {
      console.error("Failed to create job-completion-confirmation-requested notification", error);
    }

    // Module 66: announce completion as a domain event (for Module 67's
    // future premature-completion detection — see this use case's own
    // doc comment) and, if wired, look up the confirmation row
    // `JobRepository.complete` just created atomically to report its
    // real deadline rather than recomputing it here.
    if (this.eventBus) {
      try {
        const confirmation = this.confirmations ? await this.confirmations.findByJobId(jobId) : null;
        await this.eventBus.publishAll([
          new ProfessionalCompletedJob(
            jobId,
            job.professionalProfileId,
            job.companyProfileId,
            userId,
            job.startedAt,
            completed.completedAt ?? new Date(),
            confirmation?.confirmationDeadlineAt ?? completed.completedAt ?? new Date(),
          ),
        ]);
      } catch (error) {
        if (error instanceof EventDispatchError) {
          this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
        } else {
          console.error("Failed to publish ProfessionalCompletedJob", error);
        }
      }
    }

    return completed;
  }
}
