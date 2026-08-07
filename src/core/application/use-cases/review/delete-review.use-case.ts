import { NotFoundError } from "@/domain/errors/domain-error";
import { ReviewDeleted } from "@/domain/events/review-deleted";
import type { ReviewRecord, ReviewRepository } from "@/domain/repositories/review-repository";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/**
 * Module 41 — Reviews & Ratings: lets a review's own author soft-delete it
 * — sets `Review.deletedAt`, which every public-facing read
 * (`listByProfessionalId`, `getProfessionalRatingSummary`) already
 * excludes (see `PrismaReviewRepository`'s `PUBLIC_WHERE`). The row itself,
 * its rating, and its full history are preserved — never a hard delete —
 * same "soft delete, preserve the audit trail" convention Module 16 Admin
 * Panel's own moderation (`ModerateReviewUseCase`) already established for
 * `Review.status`; this is the equivalent lever for the author rather than
 * an admin.
 *
 * Only the review's author may delete it — an unrelated user (including
 * the reviewed professional) gets `NotFoundError`, same convention as
 * `UpdateReviewUseCase`. Deleting an already-deleted review is idempotent
 * at the repository level but rejected here with `NotFoundError` — from
 * the caller's perspective a soft-deleted review no longer exists.
 *
 * No time-window restriction (unlike `UpdateReviewUseCase`) — removing consent
 * to have left feedback at all is treated differently from revising its
 * content indefinitely; this mirrors how most consumer platforms allow a
 * review's author to retract it at any time while still bounding *edits*.
 */
export class DeleteReviewUseCase {
  constructor(
    private readonly reviews: ReviewRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(userId: string, reviewId: string): Promise<ReviewRecord> {
    const review = await this.reviews.findById(reviewId);
    if (!review || review.deletedAt) {
      throw new NotFoundError("Review", reviewId);
    }

    if (review.reviewerId !== userId) {
      throw new NotFoundError("Review", reviewId);
    }

    const deleted = await this.reviews.softDelete(reviewId);
    if (!deleted) {
      throw new NotFoundError("Review", reviewId);
    }

    try {
      await this.eventBus.publishAll([new ReviewDeleted(deleted.id, deleted.jobId, userId)]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return deleted;
  }
}
