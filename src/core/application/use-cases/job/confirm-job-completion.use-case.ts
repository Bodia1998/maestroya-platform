import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { JobCompletionConfirmationRecord, JobCompletionConfirmationRepository } from "@/domain/repositories/job-completion-confirmation-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import { isAlreadyConfirmed, WAITING_FOR_CUSTOMER_STATUS } from "@/domain/services/job-completion-confirmation-state";
import { resolveJobActor } from "./resolve-job-actor";
import { CustomerConfirmedCompletion } from "@/domain/events/customer-confirmed-completion";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import type { EvaluatePaymentReleaseUseCase } from "./evaluate-payment-release.use-case";
import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";

/**
 * Module 66 — Job Completion & Payment Release Protection: the
 * customer-facing action that confirms a completed service was received.
 * This is the ONLY way a Job's payment can move toward release short of
 * an admin override or a (never auto-releasing — see
 * job-completion-confirmation-rules.ts) confirmation timeout under manual
 * review.
 *
 * Authorization: reuses `resolveJobActor` — the exact same IDOR-safe
 * "re-derive ownership from the session, never trust client input"
 * mechanism `CompleteJobUseCase`/`CreateDisputeUseCase` already use.
 * `actor.role !== "customer"` (a professional, a company member, or an
 * unrelated user resolving to `NotFoundError`) is rejected — a
 * professional can never confirm on their own behalf, closing the exact
 * gap this module exists to close.
 *
 * Idempotency: a second confirmation attempt on an already-CONFIRMED row
 * is a safe no-op (returns the existing record unchanged) rather than an
 * error — mirrors how a duplicate button press/network retry must never
 * fail loudly for an action that already succeeded. Attempting to confirm
 * a DISPUTED or TIMED_OUT_UNDER_REVIEW row (both terminal — see
 * job-completion-confirmation-state.ts) is rejected with a
 * `ValidationError`: once a dispute exists or the window has lapsed into
 * manual review, confirming is no longer a customer self-service action.
 *
 * Concurrency: the repository's `confirm` method is guarded by
 * `expectedStatuses: [WAITING_FOR_CUSTOMER]` (optimistic concurrency, the
 * same convention as every other mutating repository method in this
 * codebase) — two concurrent confirmation requests can never both apply;
 * the loser sees the fresh (already-CONFIRMED) row via the idempotency
 * check below rather than an error, since by the time it re-reads, the
 * winner already confirmed the exact same outcome.
 */
export class ConfirmJobCompletionUseCase {
  constructor(
    private readonly jobs: JobRepository,
    private readonly confirmations: JobCompletionConfirmationRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly evaluateRelease: EvaluatePaymentReleaseUseCase,
    private readonly eventBus: EventBus,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(userId: string, jobId: string): Promise<JobCompletionConfirmationRecord> {
    const job = await this.jobs.findById(jobId);
    if (!job) {
      throw new NotFoundError("Job", jobId);
    }

    const actor = await resolveJobActor(userId, job, {
      customerProfiles: this.customerProfiles,
      professionals: this.professionals,
    });
    if (actor.role !== "customer") {
      throw new ValidationError("Only the customer can confirm this job's completion.");
    }

    const confirmation = await this.confirmations.findByJobId(jobId);
    if (!confirmation) {
      throw new ValidationError("This job has not been marked completed by the professional yet.");
    }

    if (isAlreadyConfirmed(confirmation.status)) {
      // Idempotent no-op — see this class's own doc comment.
      return confirmation;
    }

    if (confirmation.status !== WAITING_FOR_CUSTOMER_STATUS) {
      throw new ValidationError(
        confirmation.status === "DISPUTED"
          ? "This job's completion has already been disputed and can no longer be confirmed."
          : "This job's confirmation window has already closed and is under manual review.",
      );
    }

    let confirmed: JobCompletionConfirmationRecord;
    try {
      confirmed = await this.confirmations.confirm({
        id: confirmation.id,
        confirmedByUserId: userId,
        confirmedAt: new Date(),
        expectedStatuses: [WAITING_FOR_CUSTOMER_STATUS],
      });
    } catch (error) {
      if (error instanceof ConflictError) {
        // Lost a race — most likely a concurrent duplicate confirmation
        // that won first, or (far less likely) the timeout worker firing
        // at the exact same instant. Re-read and treat exactly like the
        // idempotency check above: an already-CONFIRMED row is success,
        // anything else surfaces as the same validation message.
        const fresh = await this.confirmations.findById(confirmation.id);
        if (fresh && isAlreadyConfirmed(fresh.status)) {
          return fresh;
        }
        throw new ValidationError("This job's completion confirmation was just resolved by another request.");
      }
      throw error;
    }

    // Re-evaluate the release decision now that the customer has
    // confirmed — this is what can move the outcome to RELEASE_APPROVED
    // (still subject to KYC/payout-hold/dispute checks — confirming alone
    // is never sufficient, see payment-release-decision.ts).
    await this.evaluateRelease.execute(jobId);

    const recipientUserIds = await this.resolveProfessionalSideUserIds(job);

    try {
      await this.eventBus.publishAll([
        new CustomerConfirmedCompletion(jobId, confirmed.id, userId, recipientUserIds),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    for (const recipientUserId of recipientUserIds) {
      try {
        await this.notifications.notify({
          userId: recipientUserId,
          type: "JOB_COMPLETION_CONFIRMED",
          title: "Service confirmed",
          message: "The customer confirmed the completed service.",
          resourceType: "JOB",
          resourceId: jobId,
          actionUrl: `/jobs/${jobId}`,
        });
      } catch (error) {
        console.error("Failed to create job-completion-confirmed notification", error);
      }
    }

    return confirmed;
  }

  private async resolveProfessionalSideUserIds(job: {
    professionalProfileId: string | null;
    companyProfileId: string | null;
  }): Promise<string[]> {
    if (job.professionalProfileId) {
      const professional = await this.professionals.findById(job.professionalProfileId);
      return professional ? [professional.userId] : [];
    }
    return [];
  }
}
