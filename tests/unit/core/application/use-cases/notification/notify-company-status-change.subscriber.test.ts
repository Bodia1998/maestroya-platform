import { describe, expect, it } from "vitest";

import { NotifyCompanyStatusChangeSubscriber } from "@/application/use-cases/notification/notify-company-status-change.subscriber";
import { CompanyStatusChanged } from "@/domain/events/company-status-changed";
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

describe("application/use-cases/notification/notify-company-status-change.subscriber", () => {
  it("notifies the company owner with a SUSPENDED-specific title/message when newStatus is SUSPENDED", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyCompanyStatusChangeSubscriber(notifications);

    await subscriber.handle(new CompanyStatusChanged("company-1", "owner-1", "ACTIVE", "SUSPENDED", "admin-1"));

    expect(notifications.events).toHaveLength(1);
    expect(notifications.events[0]).toMatchObject({
      userId: "owner-1",
      type: "COMPANY_SUSPENDED",
      title: "Your company has been suspended",
      resourceType: "COMPANY",
      resourceId: "company-1",
    });
  });

  it("notifies the company owner with a REACTIVATED-specific title/message when newStatus is ACTIVE", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyCompanyStatusChangeSubscriber(notifications);

    await subscriber.handle(new CompanyStatusChanged("company-1", "owner-1", "SUSPENDED", "ACTIVE", "admin-2"));

    expect(notifications.events).toHaveLength(1);
    expect(notifications.events[0]).toMatchObject({
      userId: "owner-1",
      type: "COMPANY_REACTIVATED",
      title: "Your company has been reactivated",
      resourceType: "COMPANY",
      resourceId: "company-1",
    });
  });

  it("propagates a notification-service failure rather than swallowing it — the EventBus owns the failure contract", async () => {
    const subscriber = new NotifyCompanyStatusChangeSubscriber(new ThrowingNotificationCreator());

    await expect(
      subscriber.handle(new CompanyStatusChanged("company-1", "owner-1", "ACTIVE", "SUSPENDED", "admin-1")),
    ).rejects.toThrow("notification service outage");
  });
});
