import type { SupportTicketStatusChanged } from "@/domain/events/support-ticket-status-changed";
import type { EventHandler } from "@/application/ports/event-bus";
import type { NotificationCreator, NotificationEvent } from "@/application/ports/notification-creator";

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * The `NotificationSubscriber` for `SupportTicketStatusChanged`
 * (`domain/events/support-ticket-status-changed.ts`) — mirrors
 * `NotifyProfessionalVerificationStatusChangeSubscriber` exactly. Reacts to
 * the event by calling the existing `NotificationCreator` port — the same
 * `notify(...)` call the four support-ticket use cases used to make
 * directly, each wrapped in their own local `try/catch { console.error(...) }`.
 *
 * Unlike the verification module, this is NOT a straight lookup table:
 * `ChangeSupportTicketStatusUseCase`'s pre-Module-37 message was built
 * dynamically from the status it was transitioning to
 * (`` `Ticket ${n} is now ${nextStatus.replaceAll("_", " ").toLowerCase()}.` ``),
 * and ASSIGNED's `actionUrl` points at the admin console
 * (`/admin/support-tickets/:id`) while every other transition's
 * `actionUrl` points at the ticket-opener's own view
 * (`/support-tickets/:id`) — both reproduced byte for byte below rather
 * than collapsed into a table that can't express them.
 *
 * A `null` `recipientUserId` (ASSIGNED-as-unassignment — see the event's
 * own doc comment) is a no-op, not an error: the pre-Module-37
 * `AssignSupportTicketUseCase` silently skipped the notification in that
 * case too (while still recording the audit entry via the sibling
 * subscriber).
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `notification/compose.ts`.
 * Does not swallow its own failure — it lets a thrown error propagate to
 * `SynchronousEventBus`, which turns it into an `EventDispatchError` the
 * publishing use case reports through `FailureReporter`.
 */
export class NotifySupportTicketStatusChangeSubscriber implements EventHandler<SupportTicketStatusChanged> {
  constructor(private readonly notifications: NotificationCreator) {}

  async handle(event: SupportTicketStatusChanged): Promise<void> {
    if (!event.recipientUserId) return;

    const { type, title, message, actionUrl, metadata } = this.buildNotification(event);

    await this.notifications.notify({
      userId: event.recipientUserId,
      type,
      title,
      message,
      resourceType: "SUPPORT_TICKET",
      resourceId: event.ticketId,
      actionUrl,
      metadata,
    });
  }

  private buildNotification(
    event: SupportTicketStatusChanged,
  ): Pick<NotificationEvent, "type" | "title" | "message" | "actionUrl" | "metadata"> {
    switch (event.transition) {
      case "ASSIGNED":
        return {
          type: "SUPPORT_TICKET_ASSIGNED",
          title: "A support ticket was assigned to you",
          message: `Ticket ${event.ticketNumber} was assigned to you.`,
          actionUrl: `/admin/support-tickets/${event.ticketId}`,
          metadata: { ticketNumber: event.ticketNumber },
        };
      case "STATUS_CHANGED":
        return {
          type: "SUPPORT_TICKET_STATUS_CHANGED",
          title: "Your support ticket was updated",
          message: `Ticket ${event.ticketNumber} is now ${(event.newStatus ?? "").replaceAll("_", " ").toLowerCase()}.`,
          actionUrl: `/support-tickets/${event.ticketId}`,
          metadata: { ticketNumber: event.ticketNumber, status: event.newStatus },
        };
      case "RESOLVED":
        return {
          type: "SUPPORT_TICKET_RESOLVED",
          title: "Your support ticket was resolved",
          message: `Ticket ${event.ticketNumber} has been resolved.`,
          actionUrl: `/support-tickets/${event.ticketId}`,
          metadata: { ticketNumber: event.ticketNumber },
        };
      case "CLOSED":
        return {
          type: "SUPPORT_TICKET_CLOSED",
          title: "Your support ticket was closed",
          message: `Ticket ${event.ticketNumber} has been closed.`,
          actionUrl: `/support-tickets/${event.ticketId}`,
          metadata: { ticketNumber: event.ticketNumber },
        };
    }
  }
}
