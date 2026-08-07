import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { ReviewDeleted } from "@/domain/events/review-deleted";
import type { EventHandler } from "@/application/ports/event-bus";

/**
 * Module 41 — Reviews & Ratings (Domain Event Subscribers).
 *
 * The `AuditLogSubscriber` for `ReviewDeleted` — records that the review's
 * own author soft-deleted it (see `DeleteReviewUseCase`/
 * `ReviewRecord.deletedAt`'s own doc comments for why this is a soft, not
 * hard, delete).
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `review/compose.ts`.
 */
export class RecordReviewDeletedAuditLogSubscriber implements EventHandler<ReviewDeleted> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: ReviewDeleted): Promise<void> {
    await this.auditLog.record({
      adminUserId: event.reviewerId,
      action: "REVIEW_DELETED",
      targetType: "Review",
      targetId: event.reviewId,
      metadata: { jobId: event.jobId },
    });
  }
}
