import type { DisputeAssigned } from "@/domain/events/dispute-assigned";
import type { EventHandler } from "@/application/ports/event-bus";
import type { NotificationCreator } from "@/application/ports/notification-creator";

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * The `NotificationSubscriber` for `DisputeAssigned`
 * (`domain/events/dispute-assigned.ts`) — reacts to the event by calling
 * the existing `NotificationCreator` port, the same `notify(...)` call
 * `AssignDisputeUseCase` used to make directly.
 *
 * A `null` `newAssigneeUserId` (unassigning) is a no-op, not an error — the
 * pre-Module-37 use case's own `if (assigneeUserId)` guard skipped the
 * notification in that case too (while still recording the audit entry via
 * the sibling subscriber).
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `notification/compose.ts`.
 */
export class NotifyDisputeAssignedSubscriber implements EventHandler<DisputeAssigned> {
  constructor(private readonly notifications: NotificationCreator) {}

  async handle(event: DisputeAssigned): Promise<void> {
    if (!event.newAssigneeUserId) return;

    await this.notifications.notify({
      userId: event.newAssigneeUserId,
      type: "DISPUTE_ASSIGNED",
      title: "A dispute was assigned to you",
      message: `Dispute ${event.caseNumber} was assigned to you.`,
      resourceType: "DISPUTE",
      resourceId: event.disputeId,
      actionUrl: `/admin/disputes/${event.disputeId}`,
      metadata: { caseNumber: event.caseNumber },
    });
  }
}
