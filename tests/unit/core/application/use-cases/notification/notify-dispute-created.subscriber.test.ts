import { describe, expect, it } from "vitest";

import { NotifyDisputeCreatedSubscriber } from "@/application/use-cases/notification/notify-dispute-created.subscriber";
import { DisputeCreated } from "@/domain/events/dispute-created";
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

describe("application/use-cases/notification/notify-dispute-created.subscriber", () => {
  it("fans out to every respondent", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyDisputeCreatedSubscriber(notifications);

    await subscriber.handle(
      new DisputeCreated("dispute-1", "DSP-2026-000001", "job-1", "SERVICE_QUALITY", "user-1", ["user-2", "user-3"]),
    );

    expect(notifications.events).toHaveLength(2);
    expect(notifications.events.map((e) => e.userId).sort()).toEqual(["user-2", "user-3"]);
    expect(notifications.events[0]).toMatchObject({
      type: "DISPUTE_CREATED",
      title: "A dispute was opened",
      message: "A dispute (DSP-2026-000001) was opened regarding your job.",
      resourceType: "DISPUTE",
      resourceId: "dispute-1",
      actionUrl: "/disputes/dispute-1",
      metadata: { jobId: "job-1", caseNumber: "DSP-2026-000001" },
    });
  });

  it("is a no-op when recipientUserIds is empty", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyDisputeCreatedSubscriber(notifications);

    await subscriber.handle(new DisputeCreated("dispute-1", "DSP-2026-000001", "job-1", "OTHER", "user-1", []));

    expect(notifications.events).toHaveLength(0);
  });

  it("propagates a notification-service failure rather than swallowing it — the EventBus owns the failure contract", async () => {
    const subscriber = new NotifyDisputeCreatedSubscriber(new ThrowingNotificationCreator());

    await expect(
      subscriber.handle(new DisputeCreated("dispute-1", "DSP-2026-000001", "job-1", "OTHER", "user-1", ["user-2"])),
    ).rejects.toThrow("notification service outage");
  });
});
