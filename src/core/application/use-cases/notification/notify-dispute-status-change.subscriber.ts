import type { DisputeStatusChanged } from "@/domain/events/dispute-status-changed";
import type { EventHandler } from "@/application/ports/event-bus";
import type { NotificationCreator, NotificationEvent } from "@/application/ports/notification-creator";

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * The `NotificationSubscriber` for `DisputeStatusChanged`
 * (`domain/events/dispute-status-changed.ts`) — mirrors
 * `NotifyProfessionalVerificationStatusChangeSubscriber`, extended to fan
 * out to every entry of `event.recipientUserIds` (a Dispute notifies both
 * sides of the underlying Job, not a single owner — see the event's own
 * doc comment). No business logic here beyond what
 * `ResolveDisputeUseCase`/`RejectDisputeUseCase`/`CloseDisputeUseCase`/
 * `ChangeDisputeStatusUseCase` already computed inline: the title/
 * message/type per transition, byte for byte.
 *
 * `STATUS_CHANGED` alone doesn't fully determine the copy — `newStatus`
 * further distinguishes a "response requested" notification
 * (`WAITING_FOR_CUSTOMER`/`WAITING_FOR_PROFESSIONAL`) from a plain
 * "status updated" one, exactly as `ChangeDisputeStatusUseCase`'s own
 * pre-Module-37 `isResponseRequest` check did.
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `notification/compose.ts`.
 * Unlike the old inline `try/catch`, this subscriber does *not* swallow its
 * own failure — it lets a thrown error propagate to `SynchronousEventBus`,
 * which turns it into an `EventDispatchError` the publishing use case
 * reports through `FailureReporter`.
 */
export class NotifyDisputeStatusChangeSubscriber implements EventHandler<DisputeStatusChanged> {
  constructor(private readonly notifications: NotificationCreator) {}

  async handle(event: DisputeStatusChanged): Promise<void> {
    const { type, title, message, metadata } = this.buildContent(event);

    for (const userId of event.recipientUserIds) {
      const notification: NotificationEvent = {
        userId,
        type,
        title,
        message,
        resourceType: "DISPUTE",
        resourceId: event.disputeId,
        actionUrl: `/disputes/${event.disputeId}`,
        metadata,
      };
      await this.notifications.notify(notification);
    }
  }

  private buildContent(event: DisputeStatusChanged): {
    type: NotificationEvent["type"];
    title: string;
    message: string;
    metadata: Record<string, unknown>;
  } {
    switch (event.transition) {
      case "RESOLVED":
        return {
          type: "DISPUTE_RESOLVED",
          title: "Your dispute was resolved",
          message: `Dispute ${event.caseNumber} has been resolved.`,
          metadata: { caseNumber: event.caseNumber, resolution: event.resolution },
        };
      case "REJECTED":
        return {
          type: "DISPUTE_REJECTED",
          title: "Your dispute was rejected",
          message: `Dispute ${event.caseNumber} has been rejected.`,
          metadata: { caseNumber: event.caseNumber },
        };
      case "CLOSED":
        return {
          type: "DISPUTE_CLOSED",
          title: "Your dispute was closed",
          message: `Dispute ${event.caseNumber} has been closed.`,
          metadata: { caseNumber: event.caseNumber },
        };
      case "STATUS_CHANGED": {
        const isResponseRequest =
          event.newStatus === "WAITING_FOR_CUSTOMER" || event.newStatus === "WAITING_FOR_PROFESSIONAL";
        return {
          type: isResponseRequest ? "DISPUTE_RESPONSE_REQUESTED" : "DISPUTE_STATUS_CHANGED",
          title: isResponseRequest ? "Response requested on your dispute" : "Dispute status updated",
          message: `Dispute ${event.caseNumber} is now ${event.newStatus.replaceAll("_", " ").toLowerCase()}.`,
          metadata: { caseNumber: event.caseNumber, status: event.newStatus },
        };
      }
    }
  }
}
