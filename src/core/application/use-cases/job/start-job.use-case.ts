import type { JobNotifier } from "@/application/ports/job-notifier";
import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { MaterialsNotConfirmedError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { JobRecord, JobRepository } from "@/domain/repositories/job-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { QuoteRepository } from "@/domain/repositories/quote-repository";
import { isStartableStatus } from "@/domain/services/job-state";
import { canStartJobGivenMaterials } from "@/domain/services/materials-procurement-rules";
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
 *
 * Module 63 — Materials Procurement Workflow: this is the one and only
 * enforcement point for "the booking cannot begin until the customer
 * confirms that all required materials have been purchased." `quotes` is
 * optional (defaults to undefined, in which case the gate is skipped
 * entirely) purely so every pre-Module-63 direct construction of this use
 * case — this codebase's own tests, and any caller that hasn't been
 * updated yet — keeps compiling and behaving exactly as before; every
 * real caller (see job/compose.ts) always supplies it, so the gate is
 * always active in production. When supplied, the Job's accepted Quote is
 * re-fetched fresh here (never trusted from a previously-read value) so a
 * customer confirming materials concurrently with the professional
 * clicking "start" is always resolved correctly.
 */
export class StartJobUseCase {
  constructor(
    private readonly jobs: JobRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly notifier: JobNotifier,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
    private readonly quotes?: QuoteRepository,
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

    if (this.quotes) {
      const quote = await this.quotes.findById(job.quoteId);
      if (quote && !canStartJobGivenMaterials(quote.materialsStrategy, quote.materialsConfirmedAt)) {
        throw new MaterialsNotConfirmedError();
      }
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

    try {
      const customer = await this.customerProfiles.findById(job.customerId);
      if (customer) {
        await this.notifications.notify({
          userId: customer.userId,
          type: "JOB_STARTED",
          title: "Work has started",
          message: "The professional started work on your job.",
          resourceType: "JOB",
          resourceId: job.id,
          actionUrl: `/jobs/${job.id}`,
        });
      }
    } catch (error) {
      console.error("Failed to create job-started notification", error);
    }

    return started;
  }
}
