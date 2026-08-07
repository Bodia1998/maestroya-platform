import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { ReviewCreated } from "@/domain/events/review-created";
import type { EventHandler } from "@/application/ports/event-bus";

/**
 * Module 41 — Reviews & Ratings (Domain Event Subscribers, following the
 * Module 37 pattern).
 *
 * The `AuditLogSubscriber` for `ReviewCreated` (`domain/events/review-created.ts`)
 * — reuses the same append-only `AuditLog` trail every other module's
 * audit-log subscriber writes to (see `AdminAuditLogRepository`'s own doc
 * comment); `adminUserId` here is the reviewer, not an admin — same
 * "generic actor, unified trail" convention `RecordDisputeCreatedAuditLogSubscriber`
 * already established.
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `review/compose.ts`.
 */
export class RecordReviewCreatedAuditLogSubscriber implements EventHandler<ReviewCreated> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: ReviewCreated): Promise<void> {
    await this.auditLog.record({
      adminUserId: event.reviewerId,
      action: "REVIEW_CREATED",
      targetType: "Review",
      targetId: event.reviewId,
      metadata: { jobId: event.jobId, rating: event.rating },
    });
  }
}
