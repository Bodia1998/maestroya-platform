import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { ExpireCompanyVerificationsUseCase } from "@/application/use-cases/workflow-expiration/expire-company-verifications.use-case";
import type { ExpireProfessionalVerificationsUseCase } from "@/application/use-cases/workflow-expiration/expire-professional-verifications.use-case";
import type { ExpireQuotesUseCase } from "@/application/use-cases/workflow-expiration/expire-quotes.use-case";
import type { ExpireServiceRequestsUseCase } from "@/application/use-cases/workflow-expiration/expire-service-requests.use-case";

export interface RunWorkflowExpirationsResult {
  serviceRequests: { expiredCount: number; ids: string[] };
  quotes: { expiredCount: number; ids: string[] };
  professionalVerifications: { expiredCount: number; ids: string[] };
  companyVerifications: { expiredCount: number; ids: string[] };
  totalExpired: number;
}

/**
 * Module 28 — Workflow Completion: the single orchestrator the cron route
 * (src/app/api/cron/expire-workflows/route.ts) calls — runs all four
 * expiration batches for one shared `now` timestamp (so every entity's
 * "past due as of" instant is identical for a single cron invocation, never
 * subtly different because of process time drift between batches) and
 * records one summary audit-log entry for the whole run.
 *
 * Each batch runs independently and does not roll back the others if one
 * fails — a failure in, say, the verification batch must not prevent
 * ServiceRequests/Quotes (the higher-volume, more time-sensitive entities)
 * from still expiring on schedule. Each use case already isolates its own
 * per-row notification/audit-log side effects (see their own doc
 * comments); this orchestrator additionally isolates the four *batches*
 * from each other the same way.
 */
export class RunWorkflowExpirationsUseCase {
  constructor(
    private readonly expireServiceRequests: ExpireServiceRequestsUseCase,
    private readonly expireQuotes: ExpireQuotesUseCase,
    private readonly expireProfessionalVerifications: ExpireProfessionalVerificationsUseCase,
    private readonly expireCompanyVerifications: ExpireCompanyVerificationsUseCase,
    private readonly auditLog: AdminAuditLogRepository,
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

    const totalExpired =
      serviceRequests.expiredCount +
      quotes.expiredCount +
      professionalVerifications.expiredCount +
      companyVerifications.expiredCount;

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
          totalExpired,
        },
      });
    } catch (error) {
      console.error("Failed to record workflow-expiration-run audit log", error);
    }

    return { serviceRequests, quotes, professionalVerifications, companyVerifications, totalExpired };
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
