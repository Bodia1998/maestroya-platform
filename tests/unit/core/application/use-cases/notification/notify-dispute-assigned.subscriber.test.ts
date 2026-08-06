import { describe, expect, it } from "vitest";

import { NotifyDisputeAssignedSubscriber } from "@/application/use-cases/notification/notify-dispute-assigned.subscriber";
import { DisputeAssigned } from "@/domain/events/dispute-assigned";
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

describe("application/use-cases/notification/notify-dispute-assigned.subscriber", () => {
  it("notifies the new assignee", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyDisputeAssignedSubscriber(notifications);

    await subscriber.handle(new DisputeAssigned("dispute-1", "DSP-2026-000001", null, "admin-new", "admin-1"));

    expect(notifications.events).toHaveLength(1);
    expect(notifications.events[0]).toMatchObject({
      userId: "admin-new",
      type: "DISPUTE_ASSIGNED",
      title: "A dispute was assigned to you",
      message: "Dispute DSP-2026-000001 was assigned to you.",
      resourceType: "DISPUTE",
      resourceId: "dispute-1",
      actionUrl: "/admin/disputes/dispute-1",
    });
  });

  it("is a no-op when newAssigneeUserId is null (unassignment)", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyDisputeAssignedSubscriber(notifications);

    await subscriber.handle(new DisputeAssigned("dispute-1", "DSP-2026-000001", "admin-old", null, "admin-1"));

    expect(notifications.events).toHaveLength(0);
  });

  it("propagates a notification-service failure rather than swallowing it — the EventBus owns the failure contract", async () => {
    const subscriber = new NotifyDisputeAssignedSubscriber(new ThrowingNotificationCreator());

    await expect(
      subscriber.handle(new DisputeAssigned("dispute-1", "DSP-2026-000001", null, "admin-new", "admin-1")),
    ).rejects.toThrow("notification service outage");
  });
});
