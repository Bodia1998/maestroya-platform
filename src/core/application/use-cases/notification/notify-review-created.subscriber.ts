import type { ReviewCreated } from "@/domain/events/review-created";
import type { EventHandler } from "@/application/ports/event-bus";
import type { NotificationCreator } from "@/application/ports/notification-creator";

/**
 * Module 41 — Reviews & Ratings (Domain Event Subscribers, following the
 * Module 37 pattern).
 *
 * The `NotificationSubscriber` for `ReviewCreated`
 * (`domain/events/review-created.ts`) — sends the REVIEW_RECEIVED
 * notification `CreateReviewUseCase` used to send directly before Module
 * 41 (see that use case's own doc comment). No-op when
 * `event.revieweeUserId` is `null` (a company-owned Job's review — see
 * the event's own doc comment), same as the pre-Module-41 direct call's
 * own `if (professional)` guard.
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `notification/compose.ts`.
 */
export class NotifyReviewCreatedSubscriber implements EventHandler<ReviewCreated> {
  constructor(private readonly notifications: NotificationCreator) {}

  async handle(event: ReviewCreated): Promise<void> {
    if (!event.revieweeUserId) return;

    await this.notifications.notify({
      userId: event.revieweeUserId,
      type: "REVIEW_RECEIVED",
      title: "You received a new review",
      message: "A customer left a review for your completed job.",
      resourceType: "REVIEW",
      resourceId: event.reviewId,
      actionUrl: `/jobs/${event.jobId}`,
      metadata: { jobId: event.jobId, rating: event.rating },
    });
  }
}
