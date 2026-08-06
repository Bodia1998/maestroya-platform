import { describe, expect, it } from "vitest";

import { NotifySupportTicketStatusChangeSubscriber } from "@/application/use-cases/notification/notify-support-ticket-status-change.subscriber";
import { SupportTicketStatusChanged } from "@/domain/events/support-ticket-status-changed";
import type { NotificationCreator, NotificationEvent } from "@/application/ports/notification-creator";

class RecordingNotificationCreator implements NotificationCreator {
  events: NotificationEvent[] = [];
  async notify(event: NotificationEvent): Promise<void> {
    this.events.push(event);
  }
}

class ThrowingNotificationCreator implements NotificationCreator {
  async notify(): Promise<void> {
    throw new Error("notification service outage");
  }
}

describe("application/use-cases/notification/notify-support-ticket-status-change.subscriber", () => {
  it("notifies the assignee with ASSIGNED-specific copy and an admin-console actionUrl for an ASSIGNED transition", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifySupportTicketStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new SupportTicketStatusChanged(
        "ticket-1",
        "TCK-2026-000001",
        "admin-1",
        "assignee-1",
        "ASSIGNED",
        null,
        null,
        null,
        "assignee-1",
      ),
    );

    expect(notifications.events).toHaveLength(1);
    expect(notifications.events[0]).toMatchObject({
      userId: "assignee-1",
      type: "SUPPORT_TICKET_ASSIGNED",
      title: "A support ticket was assigned to you",
      message: "Ticket TCK-2026-000001 was assigned to you.",
      resourceType: "SUPPORT_TICKET",
      resourceId: "ticket-1",
      actionUrl: "/admin/support-tickets/ticket-1",
    });
  });

  it("is a no-op when recipientUserId is null (an unassignment)", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifySupportTicketStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new SupportTicketStatusChanged(
        "ticket-1",
        "TCK-2026-000001",
        "admin-1",
        null,
        "ASSIGNED",
        null,
        null,
        "assignee-1",
        null,
      ),
    );

    expect(notifications.events).toHaveLength(0);
  });

  it("notifies the opener with dynamic status text for a STATUS_CHANGED transition", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifySupportTicketStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new SupportTicketStatusChanged(
        "ticket-1",
        "TCK-2026-000001",
        "admin-1",
        "opener-1",
        "STATUS_CHANGED",
        "OPEN",
        "WAITING_FOR_USER",
      ),
    );

    expect(notifications.events[0]).toMatchObject({
      userId: "opener-1",
      type: "SUPPORT_TICKET_STATUS_CHANGED",
      title: "Your support ticket was updated",
      message: "Ticket TCK-2026-000001 is now waiting for user.",
      actionUrl: "/support-tickets/ticket-1",
    });
  });

  it("notifies the opener with RESOLVED-specific copy for a RESOLVED transition", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifySupportTicketStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new SupportTicketStatusChanged(
        "ticket-1",
        "TCK-2026-000001",
        "admin-1",
        "opener-1",
        "RESOLVED",
        "IN_PROGRESS",
        "RESOLVED",
      ),
    );

    expect(notifications.events[0]).toMatchObject({
      type: "SUPPORT_TICKET_RESOLVED",
      title: "Your support ticket was resolved",
      message: "Ticket TCK-2026-000001 has been resolved.",
      actionUrl: "/support-tickets/ticket-1",
    });
  });

  it("notifies the opener with CLOSED-specific copy for a CLOSED transition", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifySupportTicketStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new SupportTicketStatusChanged(
        "ticket-1",
        "TCK-2026-000001",
        "admin-1",
        "opener-1",
        "CLOSED",
        "RESOLVED",
        "CLOSED",
      ),
    );

    expect(notifications.events[0]).toMatchObject({
      type: "SUPPORT_TICKET_CLOSED",
      title: "Your support ticket was closed",
      message: "Ticket TCK-2026-000001 has been closed.",
      actionUrl: "/support-tickets/ticket-1",
    });
  });

  it("propagates a notification-service failure rather than swallowing it — the EventBus owns the failure contract", async () => {
    const subscriber = new NotifySupportTicketStatusChangeSubscriber(new ThrowingNotificationCreator());

    await expect(
      subscriber.handle(
        new SupportTicketStatusChanged(
          "ticket-1",
          "TCK-2026-000001",
          "admin-1",
          "opener-1",
          "RESOLVED",
          "IN_PROGRESS",
          "RESOLVED",
        ),
      ),
    ).rejects.toThrow("notification service outage");
  });
});
