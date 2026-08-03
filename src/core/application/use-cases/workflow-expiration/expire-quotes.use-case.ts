import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { QuoteRepository } from "@/domain/repositories/quote-repository";
import { isQuoteExpirable } from "@/domain/services/quote-expiration-rules";

export interface ExpireQuotesResult {
  expiredCount: number;
  ids: string[];
}

/**
 * Module 28 — Workflow Completion: batch use case invoked by the daily
 * expiration cron. Transitions every PENDING/SENT/VIEWED Quote whose
 * `validUntil` has passed to EXPIRED. Mirrors
 * ExpireServiceRequestsUseCase's shape/reasoning exactly (see that class's
 * own doc comment for the "defensive re-check" and "best-effort side
 * effects" rationale, both identical here).
 *
 * Notifies the submitting professional (never the customer — a Quote
 * expiring is the professional's own missed opportunity, not something the
 * customer needs to act on; the customer already sees the request itself
 * age out via ExpireServiceRequestsUseCase if nothing was ever accepted).
 */
export class ExpireQuotesUseCase {
  constructor(
    private readonly quotes: QuoteRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
  ) {}

  async execute(now: Date): Promise<ExpireQuotesResult> {
    const candidates = await this.quotes.findExpirable(now);
    const expiredIds: string[] = [];

    for (const quote of candidates) {
      if (!isQuoteExpirable(quote.status, quote.validUntil, now)) {
        continue;
      }

      await this.quotes.updateStatus(quote.id, "EXPIRED");
      expiredIds.push(quote.id);

      try {
        await this.auditLog.record({
          adminUserId: null,
          action: "QUOTE_EXPIRED",
          targetType: "Quote",
          targetId: quote.id,
          metadata: { previousStatus: quote.status, validUntil: quote.validUntil?.toISOString() ?? null },
        });
      } catch (error) {
        console.error("Failed to record quote-expired audit log", error);
      }

      try {
        const professional = await this.professionals.findById(quote.professionalProfileId);
        if (professional) {
          await this.notifications.notify({
            userId: professional.userId,
            type: "QUOTE_EXPIRED",
            title: "Your quote has expired",
            message: "One of your quotes has expired because it was not accepted in time.",
            resourceType: "QUOTE",
            resourceId: quote.id,
            actionUrl: `/quotes/${quote.id}`,
            metadata: { quoteId: quote.id, serviceRequestId: quote.serviceRequestId },
          });
        }
      } catch (error) {
        console.error("Failed to create quote-expired notification", error);
      }
    }

    return { expiredCount: expiredIds.length, ids: expiredIds };
  }
}
