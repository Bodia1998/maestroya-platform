import type { ReviewResponseAdded } from "@/domain/events/review-response-added";
import type { EventHandler } from "@/application/ports/event-bus";
import type { NotificationCreator } from "@/application/ports/notification-creator";

/**
 * Module 41 — Reviews & Ratings (Domain Event Subscribers).
 *
 * The `NotificationSubscriber` for `ReviewResponseAdded`
 * (`domain/events/review-response-added.ts`) — notifies the original
 * reviewer (the customer) that the professional they reviewed replied.
 * Fires on every post *and* every edit (see the event's own doc comment)
 * — a re-notification on edit is intentional: the reviewer's copy of the
 * response could otherwise go stale with no way to know it changed.
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `notification/compose.ts`.
 */
export class NotifyReviewResponseAddedSubscriber implements EventHandler<ReviewResponseAdded> {
  constructor(private readonly notifications: NotificationCreator) {}

  async handle(event: ReviewResponseAdded): Promise<void> {
    await this.notifications.notify({
      userId: event.reviewerId,
      type: "REVIEW_RESPONSE_ADDED",
      title: "A professional responded to your review",
      message: "The professional you reviewed posted a response.",
      resourceType: "REVIEW",
      resourceId: event.reviewId,
      actionUrl: `/jobs/${event.jobId}`,
      metadata: { jobId: event.jobId },
    });
  }
}
