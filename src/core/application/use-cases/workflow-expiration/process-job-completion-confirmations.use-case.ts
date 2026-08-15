import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { JobCompletionConfirmationRepository } from "@/domain/repositories/job-completion-confirmation-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import { isConfirmationOverdue, isReminderDue } from "@/domain/services/job-completion-confirmation-rules";
import { WAITING_FOR_CUSTOMER_STATUS } from "@/domain/services/job-completion-confirmation-state";
import type { OpenManualReviewCaseUseCase } from "@/application/use-cases/trust-integrity/open-manual-review-case.use-case";
import type { EvaluatePaymentReleaseUseCase } from "@/application/use-cases/job/evaluate-payment-release.use-case";
import { CustomerConfirmationTimedOut } from "@/domain/events/customer-confirmation-timed-out";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";

export interface ProcessJobCompletionConfirmationsResult {
  remindersSent: number;
  timedOut: number;
  timedOutIds: string[];
}

/**
 * Module 66 — Job Completion & Payment Release Protection: the
 * confirmation-window batch, invoked by `RunWorkflowExpirationsUseCase`
 * (see that class's own doc comment and job/compose.ts's registration)
 * from the same daily/periodic cron every other workflow-expiration batch
 * already uses — no new scheduling mechanism introduced, per this
 * module's own scope boundary.
 *
 * Two responsibilities, deliberately combined into one batch (rather than
 * two separate use cases) since they share the exact same candidate query
 * shape and are both "act on WAITING_FOR_CUSTOMER rows relative to `now`":
 *
 * 1. **Reminders** — a single best-effort nudge partway through the
 *    window (see `isReminderDue`). Never a strict idempotency boundary —
 *    a duplicate reminder notification under a genuine race is tolerated
 *    (see `markReminderSent`'s own doc comment), unlike every financial
 *    write in this module.
 *
 * 2. **Timeouts** — the confirmed product decision this module exists to
 *    enforce: a confirmation window elapsing with NO customer response
 *    never auto-releases payment. Each overdue row is moved to
 *    TIMED_OUT_UNDER_REVIEW, a `ManualReviewCase` is opened (reusing
 *    Module 65's existing `OpenManualReviewCaseUseCase` with
 *    `skipAutomatedAction: true` — see `TrustRiskEventReasonValue`'s own
 *    doc comment for why this never auto-applies a Trust Score
 *    delta/TrustAutomatedAction), and the release decision is
 *    re-evaluated (landing on RELEASE_HELD, never RELEASE_APPROVED, since
 *    a WAITING_FOR_CUSTOMER/TIMED_OUT_UNDER_REVIEW confirmation status is
 *    never the CONFIRMED branch `payment-release-decision.ts` requires).
 *
 * Each row is processed independently and failures are isolated per-row
 * (mirrors `ExpireQuotesUseCase`'s own "continue the batch, don't let one
 * bad row block the rest" convention) — a crash reminding/timing-out one
 * Job must never prevent every other overdue Job in the same run from
 * being protected.
 */
export class ProcessJobCompletionConfirmationsUseCase {
  constructor(
    private readonly confirmations: JobCompletionConfirmationRepository,
    private readonly jobs: JobRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly openManualReviewCase: OpenManualReviewCaseUseCase,
    private readonly evaluateRelease: EvaluatePaymentReleaseUseCase,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly eventBus: EventBus,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(now: Date): Promise<ProcessJobCompletionConfirmationsResult> {
    const remindersSent = await this.processReminders(now);
    const timedOutIds = await this.processTimeouts(now);
    return { remindersSent, timedOut: timedOutIds.length, timedOutIds };
  }

  private async processReminders(now: Date): Promise<number> {
    const candidates = await this.confirmations.findDueForReminder(now);
    let sent = 0;

    for (const confirmation of candidates) {
      if (!isReminderDue(
        confirmation.status,
        confirmation.professionalCompletedAt,
        confirmation.confirmationDeadlineAt,
        confirmation.reminderSentAt,
        now,
      )) {
        continue;
      }

      try {
        const job = await this.jobs.findById(confirmation.jobId);
        if (!job) continue;
        const customer = await this.customerProfiles.findById(job.customerId);
        if (customer) {
          await this.notifications.notify({
            userId: customer.userId,
            type: "JOB_COMPLETION_CONFIRMATION_REMINDER",
            title: "Confirm your completed service",
            message: "Please confirm the completed service, or let us know if there's a problem, before the confirmation window closes.",
            resourceType: "JOB",
            resourceId: job.id,
            actionUrl: `/jobs/${job.id}`,
          });
        }
        await this.confirmations.markReminderSent(confirmation.id, now);
        sent += 1;
      } catch (error) {
        console.error("Failed to send job-completion-confirmation reminder", error);
      }
    }

    return sent;
  }

  private async processTimeouts(now: Date): Promise<string[]> {
    const candidates = await this.confirmations.findOverdue(now);
    const timedOutIds: string[] = [];

    for (const confirmation of candidates) {
      if (!isConfirmationOverdue(confirmation.status, confirmation.confirmationDeadlineAt, now)) {
        continue;
      }

      try {
        const job = await this.jobs.findById(confirmation.jobId);
        if (!job) continue;

        const customer = await this.customerProfiles.findById(job.customerId);
        if (!customer) continue;

        const manualReviewCase = await this.openManualReviewCase.execute({
          userId: customer.userId, // User.id, not CustomerProfile.id — see doc comment below on "subject of record"
          reason: "JOB_COMPLETION_CONFIRMATION_TIMEOUT",
          summary: `Job ${job.id}: the customer did not respond to the completion confirmation request within the window. Payment release is held pending manual review.`,
          riskScore: 0,
          skipAutomatedAction: true,
        });

        const updated = await this.confirmations.markTimedOut({
          id: confirmation.id,
          manualReviewCaseId: manualReviewCase.id,
          expectedStatuses: [WAITING_FOR_CUSTOMER_STATUS],
        });

        await this.evaluateRelease.execute(job.id);

        try {
          await this.auditLog.record({
            adminUserId: null,
            action: "JOB_COMPLETION_CONFIRMATION_TIMED_OUT",
            targetType: "JobCompletionConfirmation",
            targetId: updated.id,
            metadata: { jobId: job.id, manualReviewCaseId: manualReviewCase.id, deadline: confirmation.confirmationDeadlineAt.toISOString() },
          });
        } catch (error) {
          console.error("Failed to record job-completion-confirmation-timeout audit log", error);
        }

        const recipientUserIds = await this.resolveBothSideUserIds(job);
        try {
          await this.eventBus.publishAll([
            new CustomerConfirmationTimedOut(job.id, updated.id, manualReviewCase.id, recipientUserIds),
          ]);
        } catch (error) {
          if (!(error instanceof EventDispatchError)) throw error;
          this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
        }

        for (const recipientUserId of recipientUserIds) {
          try {
            await this.notifications.notify({
              userId: recipientUserId,
              type: "JOB_COMPLETION_CONFIRMATION_TIMED_OUT",
              title: "Job under review",
              message: "The customer did not respond to the completion confirmation in time. This job is now under manual review before payment can be released.",
              resourceType: "JOB",
              resourceId: job.id,
              actionUrl: `/jobs/${job.id}`,
            });
          } catch (error) {
            console.error("Failed to create confirmation-timed-out notification", error);
          }
        }

        timedOutIds.push(updated.id);
      } catch (error) {
        console.error(`Failed to process confirmation timeout for confirmation ${confirmation.id}`, error);
      }
    }

    return timedOutIds;
  }

  /**
   * `ManualReviewCase.userId` is a single-user "subject" field (Module 65
   * was designed around one user per case — see that model's own doc
   * comment) but a confirmation timeout is genuinely about two parties
   * (neither is necessarily at fault — see `job-completion-confirmation-
   * rules.ts`'s own doc comment on why this scores 0). The customer is
   * recorded as the case subject (the party whose non-response opened the
   * case) purely for Module 65's existing single-subject queue UI; the
   * professional/company side is still fully notified (see
   * `resolveBothSideUserIds` below) and the release hold applies
   * regardless of whose "fault" the case is filed under. Revisit if
   * Module 67/68 need a genuinely dual-subject review case shape.
   */
  private async resolveBothSideUserIds(job: {
    customerId: string;
    professionalProfileId: string | null;
    companyProfileId: string | null;
  }): Promise<string[]> {
    const [customer, professional] = await Promise.all([
      this.customerProfiles.findById(job.customerId),
      job.professionalProfileId ? this.professionals.findById(job.professionalProfileId) : Promise.resolve(null),
    ]);
    const ids: string[] = [];
    if (customer) ids.push(customer.userId);
    if (professional) ids.push(professional.userId);
    return ids;
  }
}
