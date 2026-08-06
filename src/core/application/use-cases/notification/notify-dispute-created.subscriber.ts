import type { DisputeCreated } from "@/domain/events/dispute-created";
import type { EventHandler } from "@/application/ports/event-bus";
import type { NotificationCreator } from "@/application/ports/notification-creator";

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * The `NotificationSubscriber` for `DisputeCreated`
 * (`domain/events/dispute-created.ts`) — fans out to every entry of
 * `event.recipientUserIds` (the respondent side only — see the event's own
 * doc comment), the same loop `CreateDisputeUseCase` used to run directly.
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `notification/compose.ts`.
 */
export class NotifyDisputeCreatedSubscriber implements EventHandler<DisputeCreated> {
  constructor(private readonly notifications: NotificationCreator) {}

  async handle(event: DisputeCreated): Promise<void> {
    for (const respondentUserId of event.recipientUserIds) {
      await this.notifications.notify({
        userId: respondentUserId,
        type: "DISPUTE_CREATED",
        title: "A dispute was opened",
        message: `A dispute (${event.caseNumber}) was opened regarding your job.`,
        resourceType: "DISPUTE",
        resourceId: event.disputeId,
        actionUrl: `/disputes/${event.disputeId}`,
        metadata: { jobId: event.jobId, caseNumber: event.caseNumber },
      });
    }
  }
}
