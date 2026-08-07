import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 41 — Reviews & Ratings.
 *
 * Raised whenever a new `Review` is created for a completed Job (see
 * `CreateReviewUseCase`, `application/use-cases/review/`). Replaces that
 * use case's pre-Module-41 direct `NotificationCreator.notify(...)` call —
 * side effects (the REVIEW_RECEIVED notification, the audit log entry) now
 * react to this event instead, the same "publish, don't call directly"
 * pattern every other event-driven module in this codebase already follows
 * (see `DisputeCreated`'s own doc comment, which this mirrors).
 */
export class ReviewCreated extends DomainEvent {
  static readonly eventName = "review.created";

  constructor(
    readonly reviewId: string,
    readonly jobId: string,
    /** The reviewer — always the Job's customer (see resolveJobActor). */
    readonly reviewerId: string,
    /** The reviewed professional's User.id — `null` when the Job has no
     *  solo professional attached (a company-owned Job — see
     *  ReviewRecord.revieweeProfessionalProfileId's own doc comment for why
     *  that case is not fully supported yet), in which case no
     *  REVIEW_RECEIVED notification is sent. */
    readonly revieweeUserId: string | null,
    readonly rating: number,
  ) {
    super();
  }
}
