import { describe, expect, it } from "vitest";

import { NotifyProfessionalVerificationStatusChangeSubscriber } from "@/application/use-cases/notification/notify-professional-verification-status-change.subscriber";
import { ProfessionalVerificationStatusChanged } from "@/domain/events/professional-verification-status-changed";
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

describe("application/use-cases/notification/notify-professional-verification-status-change.subscriber", () => {
  it("notifies the professional with SUBMITTED-specific copy for a SUBMITTED transition", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyProfessionalVerificationStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new ProfessionalVerificationStatusChanged(
        "verification-1",
        "profile-1",
        "pro-1",
        "DRAFT",
        "PENDING",
        "pro-1",
        "SUBMITTED",
        2,
      ),
    );

    expect(notifications.events).toHaveLength(1);
    expect(notifications.events[0]).toMatchObject({
      userId: "pro-1",
      type: "VERIFICATION_SUBMITTED",
      title: "Verification request submitted",
      resourceType: "PROFESSIONAL_VERIFICATION",
      resourceId: "verification-1",
      actionUrl: "/dashboard/professional/verification",
    });
  });

  it("notifies the professional with distinct RESUBMITTED-specific copy even though newStatus is also PENDING", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyProfessionalVerificationStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new ProfessionalVerificationStatusChanged(
        "verification-1",
        "profile-1",
        "pro-1",
        "REJECTED",
        "PENDING",
        "pro-1",
        "RESUBMITTED",
        1,
      ),
    );

    expect(notifications.events[0]).toMatchObject({
      type: "VERIFICATION_SUBMITTED",
      title: "Verification request resubmitted",
    });
  });

  it("notifies with APPROVED-specific copy for an APPROVED transition", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyProfessionalVerificationStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new ProfessionalVerificationStatusChanged(
        "verification-1",
        "profile-1",
        "pro-1",
        "PENDING",
        "APPROVED",
        "admin-1",
        "APPROVED",
      ),
    );

    expect(notifications.events[0]).toMatchObject({ type: "VERIFICATION_APPROVED", userId: "pro-1" });
  });

  it("notifies with REJECTED-specific copy for a REJECTED transition", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyProfessionalVerificationStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new ProfessionalVerificationStatusChanged(
        "verification-1",
        "profile-1",
        "pro-1",
        "PENDING",
        "REJECTED",
        "admin-1",
        "REJECTED",
      ),
    );

    expect(notifications.events[0]).toMatchObject({ type: "VERIFICATION_REJECTED" });
  });

  it("notifies with RESUBMISSION_REQUIRED-specific copy for a RESUBMISSION_REQUESTED transition", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyProfessionalVerificationStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new ProfessionalVerificationStatusChanged(
        "verification-1",
        "profile-1",
        "pro-1",
        "PENDING",
        "RESUBMISSION_REQUIRED",
        "admin-1",
        "RESUBMISSION_REQUESTED",
      ),
    );

    expect(notifications.events[0]).toMatchObject({ type: "VERIFICATION_RESUBMISSION_REQUIRED" });
  });

  it("is a no-op when professionalUserId is null (defensive profile-not-found edge case)", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyProfessionalVerificationStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new ProfessionalVerificationStatusChanged(
        "verification-1",
        "profile-1",
        null,
        "PENDING",
        "APPROVED",
        "admin-1",
        "APPROVED",
      ),
    );

    expect(notifications.events).toHaveLength(0);
  });

  it("propagates a notification-service failure rather than swallowing it — the EventBus owns the failure contract", async () => {
    const subscriber = new NotifyProfessionalVerificationStatusChangeSubscriber(new ThrowingNotificationCreator());

    await expect(
      subscriber.handle(
        new ProfessionalVerificationStatusChanged(
          "verification-1",
          "profile-1",
          "pro-1",
          "DRAFT",
          "PENDING",
          "pro-1",
          "SUBMITTED",
          1,
        ),
      ),
    ).rejects.toThrow("notification service outage");
  });
});
