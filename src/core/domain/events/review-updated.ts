import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 41 — Reviews & Ratings.
 *
 * Raised whenever a review's author edits its `rating`/`comment` (see
 * `UpdateReviewUseCase`) within the edit window
 * (`REVIEW_EDIT_WINDOW_HOURS`, `domain/services/review-rules.ts`). Reacted
 * to by `RecordReviewUpdatedAuditLogSubscriber` — no notification is sent
 * for an edit (see that subscriber's own doc comment for why).
 */
export class ReviewUpdated extends DomainEvent {
  static readonly eventName = "review.updated";

  constructor(
    readonly reviewId: string,
    readonly jobId: string,
    readonly reviewerId: string,
    readonly previousRating: number,
    readonly newRating: number,
  ) {
    super();
  }
}
