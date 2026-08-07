import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { ReviewUpdated } from "@/domain/events/review-updated";
import type { ReviewRecord, ReviewRepository } from "@/domain/repositories/review-repository";
import { isValidRating, isWithinReviewEditWindow, normalizeComment } from "@/domain/services/review-rules";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

export interface UpdateReviewInput {
  rating: number;
  comment: string | null;
}

/**
 * Module 41 — Reviews & Ratings: lets a review's own author edit its
 * `rating`/`comment` — the one gap Module 13 explicitly left open (see
 * that module's documentation, "Immutability", now superseded by this
 * class).
 *
 * Business rules enforced here (see `review-rules.ts` for the full
 * write-up of each):
 *   - Only the review's author (`reviewerId`) may edit it — an unrelated
 *     user, including the reviewed professional, gets `NotFoundError`
 *     (same "no distinguishable forbidden response" convention every other
 *     ownership check in this codebase follows — see
 *     `CreateReviewUseCase`'s own doc comment).
 *   - Only within `REVIEW_EDIT_WINDOW_HOURS` of the review's original
 *     `createdAt` — a stale edit is rejected with `ValidationError`, not
 *     silently allowed forever. Chosen over a stricter "no edits once the
 *     professional has responded" rule so a customer amending a typo
 *     within the window is never blocked by something outside their
 *     control (when the professional happens to reply); the professional's
 *     response itself remains fully auditable via
 *     `RecordReviewResponseAddedAuditLogSubscriber` regardless of later
 *     review edits.
 *   - A soft-deleted review (`deletedAt` set — see `DeleteReviewUseCase`)
 *     can no longer be edited.
 *   - The new rating must still be a valid 1–5 integer — same
 *     `isValidRating` check `CreateReviewUseCase` applies.
 *
 * Publishes `ReviewUpdated` (audit log only — no notification; see that
 * event's own doc comment) rather than writing the audit log entry
 * directly, same event-driven pattern `CreateReviewUseCase` uses.
 */
export class UpdateReviewUseCase {
  constructor(
    private readonly reviews: ReviewRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(userId: string, reviewId: string, input: UpdateReviewInput): Promise<ReviewRecord> {
    const review = await this.reviews.findById(reviewId);
    if (!review || review.deletedAt) {
      throw new NotFoundError("Review", reviewId);
    }

    if (review.reviewerId !== userId) {
      // Same "unrelated caller gets NotFoundError, never a distinguishable
      // forbidden" convention as every other ownership check in this
      // codebase (see CreateReviewUseCase's own doc comment).
      throw new NotFoundError("Review", reviewId);
    }

    if (!isWithinReviewEditWindow(review.createdAt, new Date())) {
      throw new ValidationError("This review can no longer be edited — the edit window has passed.");
    }

    if (!isValidRating(input.rating)) {
      throw new ValidationError("Rating must be a whole number from 1 to 5.");
    }

    const updated = await this.reviews.update(reviewId, {
      rating: input.rating,
      comment: normalizeComment(input.comment),
    });
    if (!updated) {
      throw new NotFoundError("Review", reviewId);
    }

    try {
      await this.eventBus.publishAll([
        new ReviewUpdated(updated.id, updated.jobId, userId, review.rating, updated.rating),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return updated;
  }
}
