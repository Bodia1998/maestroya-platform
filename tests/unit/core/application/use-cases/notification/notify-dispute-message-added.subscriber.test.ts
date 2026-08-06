import { describe, expect, it } from "vitest";

import { NotifyDisputeMessageAddedSubscriber } from "@/application/use-cases/notification/notify-dispute-message-added.subscriber";
import { DisputeMessageAdded } from "@/domain/events/dispute-message-added";
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

describe("application/use-cases/notification/notify-dispute-message-added.subscriber", () => {
  it("fans out to every recipient", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyDisputeMessageAddedSubscriber(notifications);

    await subscriber.handle(
      new DisputeMessageAdded("dispute-1", "DSP-2026-000001", "message-1", "user-1", ["user-2", "user-3"]),
    );

    expect(notifications.events).toHaveLength(2);
    expect(notifications.events.map((e) => e.userId).sort()).toEqual(["user-2", "user-3"]);
    expect(notifications.events[0]).toMatchObject({
      type: "DISPUTE_STATUS_CHANGED",
      title: "New message on your dispute",
      message: "There's a new message on dispute DSP-2026-000001.",
      resourceType: "DISPUTE",
      resourceId: "dispute-1",
      actionUrl: "/disputes/dispute-1",
    });
  });

  it("is a no-op when recipientUserIds is empty", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyDisputeMessageAddedSubscriber(notifications);

    await subscriber.handle(new DisputeMessageAdded("dispute-1", "DSP-2026-000001", "message-1", "user-1", []));

    expect(notifications.events).toHaveLength(0);
  });

  it("propagates a notification-service failure rather than swallowing it — the EventBus owns the failure contract", async () => {
    const subscriber = new NotifyDisputeMessageAddedSubscriber(new ThrowingNotificationCreator());

    await expect(
      subscriber.handle(new DisputeMessageAdded("dispute-1", "DSP-2026-000001", "message-1", "user-1", ["user-2"])),
    ).rejects.toThrow("notification service outage");
  });
});
