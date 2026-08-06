import { describe, expect, it } from "vitest";

import { NotifyDisputeStatusChangeSubscriber } from "@/application/use-cases/notification/notify-dispute-status-change.subscriber";
import { DisputeStatusChanged } from "@/domain/events/dispute-status-changed";
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

describe("application/use-cases/notification/notify-dispute-status-change.subscriber", () => {
  it("fans out to every recipient with RESOLVED-specific copy for a RESOLVED transition", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyDisputeStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new DisputeStatusChanged(
        "dispute-1",
        "DSP-2026-000001",
        "UNDER_REVIEW",
        "RESOLVED",
        "admin-1",
        "RESOLVED",
        ["user-1", "user-2"],
        "PARTIAL_RESOLUTION",
      ),
    );

    expect(notifications.events).toHaveLength(2);
    expect(notifications.events.map((e) => e.userId).sort()).toEqual(["user-1", "user-2"]);
    expect(notifications.events[0]).toMatchObject({
      type: "DISPUTE_RESOLVED",
      title: "Your dispute was resolved",
      message: "Dispute DSP-2026-000001 has been resolved.",
      resourceType: "DISPUTE",
      resourceId: "dispute-1",
      actionUrl: "/disputes/dispute-1",
      metadata: { caseNumber: "DSP-2026-000001", resolution: "PARTIAL_RESOLUTION" },
    });
  });

  it("notifies with REJECTED-specific copy for a REJECTED transition", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyDisputeStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new DisputeStatusChanged("dispute-1", "DSP-2026-000001", "UNDER_REVIEW", "REJECTED", "admin-1", "REJECTED", ["user-1"]),
    );

    expect(notifications.events[0]).toMatchObject({ type: "DISPUTE_REJECTED", title: "Your dispute was rejected" });
  });

  it("notifies with CLOSED-specific copy for a CLOSED transition", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyDisputeStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new DisputeStatusChanged("dispute-1", "DSP-2026-000001", "RESOLVED", "CLOSED", "admin-1", "CLOSED", ["user-1"]),
    );

    expect(notifications.events[0]).toMatchObject({ type: "DISPUTE_CLOSED", title: "Your dispute was closed" });
  });

  it("notifies with DISPUTE_RESPONSE_REQUESTED copy when STATUS_CHANGED lands on WAITING_FOR_CUSTOMER", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyDisputeStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new DisputeStatusChanged(
        "dispute-1",
        "DSP-2026-000001",
        "UNDER_REVIEW",
        "WAITING_FOR_CUSTOMER",
        "admin-1",
        "STATUS_CHANGED",
        ["user-1"],
      ),
    );

    expect(notifications.events[0]).toMatchObject({
      type: "DISPUTE_RESPONSE_REQUESTED",
      title: "Response requested on your dispute",
      message: "Dispute DSP-2026-000001 is now waiting for customer.",
    });
  });

  it("notifies with plain DISPUTE_STATUS_CHANGED copy for a STATUS_CHANGED transition that isn't a response request", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyDisputeStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new DisputeStatusChanged("dispute-1", "DSP-2026-000001", "OPEN", "UNDER_REVIEW", "admin-1", "STATUS_CHANGED", ["user-1"]),
    );

    expect(notifications.events[0]).toMatchObject({
      type: "DISPUTE_STATUS_CHANGED",
      title: "Dispute status updated",
      message: "Dispute DSP-2026-000001 is now under review.",
    });
  });

  it("is a no-op when recipientUserIds is empty (defensive job-not-found edge case)", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyDisputeStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new DisputeStatusChanged("dispute-1", "DSP-2026-000001", "UNDER_REVIEW", "CLOSED", "admin-1", "CLOSED", []),
    );

    expect(notifications.events).toHaveLength(0);
  });

  it("propagates a notification-service failure rather than swallowing it — the EventBus owns the failure contract", async () => {
    const subscriber = new NotifyDisputeStatusChangeSubscriber(new ThrowingNotificationCreator());

    await expect(
      subscriber.handle(
        new DisputeStatusChanged("dispute-1", "DSP-2026-000001", "UNDER_REVIEW", "RESOLVED", "admin-1", "RESOLVED", ["user-1"]),
      ),
    ).rejects.toThrow("notification service outage");
  });
});
