import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { ReviewResponseAdded } from "@/domain/events/review-response-added";
import type { EventHandler } from "@/application/ports/event-bus";

/**
 * Module 41 — Reviews & Ratings (Domain Event Subscribers).
 *
 * The `AuditLogSubscriber` for `ReviewResponseAdded` — records the
 * professional's response text on every post *and* every edit (see
 * `RespondToReviewUseCase`'s own doc comment: `Review.response` only ever
 * stores the *current* text, so this append-only audit trail is what makes
 * the full response history reconstructable).
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `review/compose.ts`.
 */
export class RecordReviewResponseAddedAuditLogSubscriber implements EventHandler<ReviewResponseAdded> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: ReviewResponseAdded): Promise<void> {
    await this.auditLog.record({
      adminUserId: event.respondedByUserId,
      action: "REVIEW_RESPONSE_ADDED",
      targetType: "Review",
      targetId: event.reviewId,
      metadata: { jobId: event.jobId, response: event.response },
    });
  }
}
