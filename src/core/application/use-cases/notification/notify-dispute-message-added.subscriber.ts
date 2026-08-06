import type { DisputeMessageAdded } from "@/domain/events/dispute-message-added";
import type { EventHandler } from "@/application/ports/event-bus";
import type { NotificationCreator } from "@/application/ports/notification-creator";

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * The `NotificationSubscriber` for `DisputeMessageAdded`
 * (`domain/events/dispute-message-added.ts`) — fans out to every entry of
 * `event.recipientUserIds`, the same `for (const recipientUserId of
 * recipientUserIds)` loop `AddDisputeMessageUseCase` used to run directly.
 * `type: "DISPUTE_STATUS_CHANGED"` reproduces that use case's own
 * pre-Module-37 choice byte for byte — there is no dedicated
 * "new message" notification type in `NotificationTypeValue` today.
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `notification/compose.ts`.
 */
export class NotifyDisputeMessageAddedSubscriber implements EventHandler<DisputeMessageAdded> {
  constructor(private readonly notifications: NotificationCreator) {}

  async handle(event: DisputeMessageAdded): Promise<void> {
    for (const recipientUserId of event.recipientUserIds) {
      await this.notifications.notify({
        userId: recipientUserId,
        type: "DISPUTE_STATUS_CHANGED",
        title: "New message on your dispute",
        message: `There's a new message on dispute ${event.caseNumber}.`,
        resourceType: "DISPUTE",
        resourceId: event.disputeId,
        actionUrl: `/disputes/${event.disputeId}`,
        metadata: { caseNumber: event.caseNumber },
      });
    }
  }
}
