import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 41 — Reviews & Ratings.
 *
 * Raised whenever a review's author soft-deletes it (see
 * `DeleteReviewUseCase`, `ReviewRecord.deletedAt`'s own doc comment for why
 * this is a soft, not hard, delete). Reacted to by
 * `RecordReviewDeletedAuditLogSubscriber` only — deleting one's own review
 * is not something the reviewed professional needs an in-app notification
 * about (out of scope for this module; see docs/MODULE_41_REVIEWS_RATINGS.md).
 */
export class ReviewDeleted extends DomainEvent {
  static readonly eventName = "review.deleted";

  constructor(
    readonly reviewId: string,
    readonly jobId: string,
    readonly reviewerId: string,
  ) {
    super();
  }
}
