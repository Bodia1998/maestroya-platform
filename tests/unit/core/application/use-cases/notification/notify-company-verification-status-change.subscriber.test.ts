import { describe, expect, it } from "vitest";

import { NotifyCompanyVerificationStatusChangeSubscriber } from "@/application/use-cases/notification/notify-company-verification-status-change.subscriber";
import { CompanyVerificationStatusChanged } from "@/domain/events/company-verification-status-changed";
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

describe("application/use-cases/notification/notify-company-verification-status-change.subscriber", () => {
  it("notifies with SUBMITTED-specific copy for a SUBMITTED transition", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyCompanyVerificationStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new CompanyVerificationStatusChanged("verification-1", "company-1", "owner-1", "DRAFT", "PENDING", "owner-1", "SUBMITTED", 2),
    );

    expect(notifications.events).toHaveLength(1);
    expect(notifications.events[0]).toMatchObject({
      userId: "owner-1",
      type: "COMPANY_VERIFICATION_SUBMITTED",
      title: "Verification request submitted",
      resourceType: "COMPANY_VERIFICATION",
      resourceId: "verification-1",
      actionUrl: "/dashboard/company/verification",
    });
  });

  it("notifies with distinct RESUBMITTED-specific copy even though newStatus is also PENDING", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyCompanyVerificationStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new CompanyVerificationStatusChanged("verification-1", "company-1", "owner-1", "REJECTED", "PENDING", "owner-1", "RESUBMITTED", 1),
    );

    expect(notifications.events[0]).toMatchObject({ type: "COMPANY_VERIFICATION_SUBMITTED", title: "Verification request resubmitted" });
  });

  it("notifies with APPROVED-specific copy for an APPROVED transition", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyCompanyVerificationStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new CompanyVerificationStatusChanged("verification-1", "company-1", "owner-1", "PENDING", "APPROVED", "admin-1", "APPROVED"),
    );

    expect(notifications.events[0]).toMatchObject({ type: "COMPANY_VERIFICATION_APPROVED", userId: "owner-1" });
  });

  it("notifies with REJECTED-specific copy for a REJECTED transition", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyCompanyVerificationStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new CompanyVerificationStatusChanged("verification-1", "company-1", "owner-1", "PENDING", "REJECTED", "admin-1", "REJECTED"),
    );

    expect(notifications.events[0]).toMatchObject({ type: "COMPANY_VERIFICATION_REJECTED" });
  });

  it("notifies with RESUBMISSION_REQUIRED-specific copy for a RESUBMISSION_REQUESTED transition", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyCompanyVerificationStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new CompanyVerificationStatusChanged(
        "verification-1",
        "company-1",
        "owner-1",
        "PENDING",
        "RESUBMISSION_REQUIRED",
        "admin-1",
        "RESUBMISSION_REQUESTED",
      ),
    );

    expect(notifications.events[0]).toMatchObject({ type: "COMPANY_VERIFICATION_RESUBMISSION_REQUIRED" });
  });

  it("is a no-op when recipientUserId is null (defensive company-not-found edge case)", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyCompanyVerificationStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new CompanyVerificationStatusChanged("verification-1", "company-1", null, "PENDING", "APPROVED", "admin-1", "APPROVED"),
    );

    expect(notifications.events).toHaveLength(0);
  });

  it("propagates a notification-service failure rather than swallowing it — the EventBus owns the failure contract", async () => {
    const subscriber = new NotifyCompanyVerificationStatusChangeSubscriber(new ThrowingNotificationCreator());

    await expect(
      subscriber.handle(
        new CompanyVerificationStatusChanged("verification-1", "company-1", "owner-1", "DRAFT", "PENDING", "owner-1", "SUBMITTED", 1),
      ),
    ).rejects.toThrow("notification service outage");
  });
});
