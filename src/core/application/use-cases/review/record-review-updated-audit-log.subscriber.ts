import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { ReviewUpdated } from "@/domain/events/review-updated";
import type { EventHandler } from "@/application/ports/event-bus";

/**
 * Module 41 — Reviews & Ratings (Domain Event Subscribers).
 *
 * The `AuditLogSubscriber` for `ReviewUpdated` — records the previous and
 * new rating so a moderator reviewing the audit trail can see exactly what
 * changed, without needing a full row-versioning scheme on `Review` itself.
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `review/compose.ts`.
 */
export class RecordReviewUpdatedAuditLogSubscriber implements EventHandler<ReviewUpdated> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: ReviewUpdated): Promise<void> {
    await this.auditLog.record({
      adminUserId: event.reviewerId,
      action: "REVIEW_UPDATED",
      targetType: "Review",
      targetId: event.reviewId,
      metadata: { jobId: event.jobId, previousRating: event.previousRating, newRating: event.newRating },
    });
  }
}
