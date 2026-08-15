import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { ExpireCompanyVerificationsUseCase } from "@/application/use-cases/workflow-expiration/expire-company-verifications.use-case";
import type { ExpireProfessionalVerificationsUseCase } from "@/application/use-cases/workflow-expiration/expire-professional-verifications.use-case";
import type { ExpireQuotesUseCase } from "@/application/use-cases/workflow-expiration/expire-quotes.use-case";
import type { ExpireServiceRequestsUseCase } from "@/application/use-cases/workflow-expiration/expire-service-requests.use-case";
import type {
  ProcessJobCompletionConfirmationsResult,
  ProcessJobCompletionConfirmationsUseCase,
} from "@/application/use-cases/workflow-expiration/process-job-completion-confirmations.use-case";

export interface RunWorkflowExpirationsResult {
  serviceRequests: { expiredCount: number; ids: string[] };
  quotes: { expiredCount: number; ids: string[] };
  professionalVerifications: { expiredCount: number; ids: string[] };
  companyVerifications: { expiredCount: number; ids: string[] };
  /** Module 66 — Job Completion & Payment Release Protection. */
  jobCompletionConfirmations: ProcessJobCompletionConfirmationsResult;
  totalExpired: number;
}

const EMPTY_JOB_COMPLETION_CONFIRMATIONS_RESULT: ProcessJobCompletionConfirmationsResult = {
  remindersSent: 0,
  timedOut: 0,
  timedOutIds: [],
};

/**
 * Module 28 — Workflow Completion, extended by Module 66 — Job Completion
 * & Payment Release Protection: the single orchestrator the cron route
 * (src/app/api/cron/expire-workflows/route.ts) calls — runs every
 * expiration/time-based batch for one shared `now` timestamp (so every
 * entity's "past due as of" instant is identical for a single cron
 * invocation, never subtly different because of process time drift
 * between batches) and records one summary audit-log entry for the whole
 * run.
 *
 * Each batch runs independently and does not roll back the others if one
 * fails — a failure in, say, the verification batch must not prevent
 * ServiceRequests/Quotes (the higher-volume, more time-sensitive entities)
 * from still expiring on schedule. Each use case already isolates its own
 * per-row notification/audit-log side effects (see their own doc
 * comments); this orchestrator additionally isolates the batches from
 * each other the same way. Module 66's own
 * `ProcessJobCompletionConfirmationsUseCase` batch (reminders + timeouts)
 * is deliberately reused here rather than given its own separate cron
 * route — see this module's own scope boundary in docs/MODULE_66_...md,
 * "Do not create an unrelated scheduling architecture."
 */
export class RunWorkflowExpirationsUseCase {
  constructor(
    private readonly expireServiceRequests: ExpireServiceRequestsUseCase,
    private readonly expireQuotes: ExpireQuotesUseCase,
    private readonly expireProfessionalVerifications: ExpireProfessionalVerificationsUseCase,
    private readonly expireCompanyVerifications: ExpireCompanyVerificationsUseCase,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly processJobCompletionConfirmations?: ProcessJobCompletionConfirmationsUseCase,
  ) {}

  async execute(now: Date = new Date()): Promise<RunWorkflowExpirationsResult> {
    const empty = { expiredCount: 0, ids: [] as string[] };

    const serviceRequests = await this.runBatch("serviceRequests", () => this.expireServiceRequests.execute(now), empty);
    const quotes = await this.runBatch("quotes", () => this.expireQuotes.execute(now), empty);
    const professionalVerifications = await this.runBatch(
      "professionalVerifications",
      () => this.expireProfessionalVerifications.execute(now),
      empty,
    );
    const companyVerifications = await this.runBatch(
      "companyVerifications",
      () => this.expireCompanyVerifications.execute(now),
      empty,
    );
    const jobCompletionConfirmations = this.processJobCompletionConfirmations
      ? await this.runBatch(
          "jobCompletionConfirmations",
          () => this.processJobCompletionConfirmations!.execute(now),
          EMPTY_JOB_COMPLETION_CONFIRMATIONS_RESULT,
        )
      : EMPTY_JOB_COMPLETION_CONFIRMATIONS_RESULT;

    const totalExpired =
      serviceRequests.expiredCount +
      quotes.expiredCount +
      professionalVerifications.expiredCount +
      companyVerifications.expiredCount +
      jobCompletionConfirmations.timedOut;

    try {
      await this.auditLog.record({
        adminUserId: null,
        action: "WORKFLOW_EXPIRATION_RUN",
        targetType: "WorkflowExpirationRun",
        targetId: now.toISOString(),
        metadata: {
          runAt: now.toISOString(),
          serviceRequestsExpired: serviceRequests.expiredCount,
          quotesExpired: quotes.expiredCount,
          professionalVerificationsExpired: professionalVerifications.expiredCount,
          companyVerificationsExpired: companyVerifications.expiredCount,
          jobCompletionConfirmationsRemindersSent: jobCompletionConfirmations.remindersSent,
          jobCompletionConfirmationsTimedOut: jobCompletionConfirmations.timedOut,
          totalExpired,
        },
      });
    } catch (error) {
      console.error("Failed to record workflow-expiration-run audit log", error);
    }

    return { serviceRequests, quotes, professionalVerifications, companyVerifications, jobCompletionConfirmations, totalExpired };
  }

  private async runBatch<T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      console.error(`Workflow expiration batch "${name}" failed`, error);
      return fallback;
    }
  }
}
