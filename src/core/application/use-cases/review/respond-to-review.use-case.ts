import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { ReviewResponseAdded } from "@/domain/events/review-response-added";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ReviewRecord, ReviewRepository } from "@/domain/repositories/review-repository";
import { normalizeResponse } from "@/domain/services/review-rules";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/**
 * Module 41 — Reviews & Ratings: lets the reviewed professional post — or
 * later edit — a public reply to a review (`Review.response`/
 * `respondedAt`, present on the schema since Module 13's own migration but
 * unused until now — see `schema.prisma`'s Review model doc comment).
 *
 * Authorization: the caller must be the `User` behind
 * `review.revieweeProfessionalProfileId` — resolved server-side via
 * `professionals.findById`, never trusted from client input. This is what
 * makes "a professional can never respond to another professional's
 * review" true by construction: there is no `professionalProfileId`
 * parameter on this use case's input at all, only `userId` (from the
 * caller's session) and `reviewId` — the reviewee is always read off the
 * Review itself, exactly the same "authoritative fact re-derived
 * server-side, never client-supplied" pattern `CreateReviewUseCase` uses
 * for the reviewee on creation. An unrelated user (including the review's
 * own author) gets the same `NotFoundError` a nonexistent review id would
 * — no distinguishable "forbidden" response, same convention as every
 * other ownership check in this codebase.
 *
 * Calling this twice for the same review is how a response is *edited* —
 * `ReviewRepository.respond` always overwrites the previous text and bumps
 * `respondedAt`, so `Review.response` only ever reflects the current text.
 * Auditability of edits is preserved not by versioning the row but by
 * `RecordReviewResponseAddedAuditLogSubscriber`, which fires (and records
 * the new text) on every call, first response or edit alike — the append-
 * only audit log is the durable history; the Review row itself is not.
 *
 * A soft-deleted review (see `DeleteReviewUseCase`) can no longer receive
 * a response — the reviewer has withdrawn the review the response would be
 * replying to.
 */
export class RespondToReviewUseCase {
  constructor(
    private readonly reviews: ReviewRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(userId: string, reviewId: string, response: string): Promise<ReviewRecord> {
    const review = await this.reviews.findById(reviewId);
    if (!review || review.deletedAt) {
      throw new NotFoundError("Review", reviewId);
    }

    if (!review.revieweeProfessionalProfileId) {
      // Company-owned Job review — no solo professional to authorize as
      // the respondent yet (see ReviewRecord.revieweeProfessionalProfileId's
      // own doc comment; this mirrors resolveJobActor's own documented
      // company-side limitation). Surfaces as NotFoundError, same as every
      // other "no relationship to this resource" case.
      throw new NotFoundError("Review", reviewId);
    }

    const professional = await this.professionals.findById(review.revieweeProfessionalProfileId);
    if (!professional || professional.userId !== userId) {
      throw new NotFoundError("Review", reviewId);
    }

    const normalized = normalizeResponse(response);
    if (!normalized) {
      throw new ValidationError("A response cannot be empty.");
    }

    const updated = await this.reviews.respond(reviewId, normalized);
    if (!updated) {
      throw new NotFoundError("Review", reviewId);
    }

    try {
      await this.eventBus.publishAll([
        new ReviewResponseAdded(updated.id, updated.jobId, userId, updated.reviewerId, normalized),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return updated;
  }
}
