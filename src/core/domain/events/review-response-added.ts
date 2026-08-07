import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 41 — Reviews & Ratings.
 *
 * Raised whenever the reviewed professional posts or edits their response
 * to a review (see `RespondToReviewUseCase`). Reacted to by
 * `NotifyReviewResponseAddedSubscriber` (notifies the original reviewer —
 * the customer — that their review received a reply) and
 * `RecordReviewResponseAddedAuditLogSubscriber` (audit trail — fires on
 * every post *and* every edit, so the full response history is
 * reconstructable from the audit log even though `Review.response` itself
 * only ever stores the current text — see `ReviewRecord.response`'s own
 * doc comment).
 */
export class ReviewResponseAdded extends DomainEvent {
  static readonly eventName = "review.response_added";

  constructor(
    readonly reviewId: string,
    readonly jobId: string,
    /** The professional's User.id who posted/edited the response. */
    readonly respondedByUserId: string,
    /** The original reviewer's User.id — always the notification
     *  recipient. */
    readonly reviewerId: string,
    /** The response text at the time this event was published — carried
     *  on the event (not re-read from the Review row) so the audit log
     *  subscriber can record exactly what was written even if a later edit
     *  overwrites `Review.response` before the audit entry is inspected —
     *  see `RespondToReviewUseCase`'s own doc comment on why the audit log,
     *  not the Review row, is this feature's durable edit history. */
    readonly response: string,
  ) {
    super();
  }
}
