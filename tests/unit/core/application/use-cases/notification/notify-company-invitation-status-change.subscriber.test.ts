import { describe, expect, it } from "vitest";

import { NotifyCompanyInvitationStatusChangeSubscriber } from "@/application/use-cases/notification/notify-company-invitation-status-change.subscriber";
import { CompanyInvitationStatusChanged } from "@/domain/events/company-invitation-status-changed";
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

describe("application/use-cases/notification/notify-company-invitation-status-change.subscriber", () => {
  it("notifies the invitee with CREATED-specific copy, keyed to the invitation, for a CREATED transition", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyCompanyInvitationStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new CompanyInvitationStatusChanged(
        "invitation-1",
        "company-1",
        "invitee-1",
        "owner-1",
        "PENDING",
        "CREATED",
        "MEMBER",
        "invitee@example.com",
      ),
    );

    expect(notifications.events).toHaveLength(1);
    expect(notifications.events[0]).toMatchObject({
      userId: "invitee-1",
      type: "COMPANY_INVITATION_RECEIVED",
      title: "You've been invited to join a company",
      resourceType: "COMPANY_INVITATION",
      resourceId: "invitation-1",
      actionUrl: "/dashboard/company/invitations",
    });
  });

  it("notifies the inviter with ACCEPTED-specific copy, keyed to the company, for an ACCEPTED transition", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyCompanyInvitationStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new CompanyInvitationStatusChanged(
        "invitation-1",
        "company-1",
        "owner-1",
        "invitee-1",
        "ACCEPTED",
        "ACCEPTED",
        "MANAGER",
      ),
    );

    expect(notifications.events[0]).toMatchObject({
      userId: "owner-1",
      type: "COMPANY_INVITATION_ACCEPTED",
      title: "Invitation accepted",
      resourceType: "COMPANY",
      resourceId: "company-1",
      actionUrl: "/dashboard/company/members",
    });
  });

  it("notifies the inviter with DECLINED-specific copy, keyed to the company, for a DECLINED transition", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyCompanyInvitationStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new CompanyInvitationStatusChanged(
        "invitation-1",
        "company-1",
        "owner-1",
        "invitee-1",
        "DECLINED",
        "DECLINED",
      ),
    );

    expect(notifications.events[0]).toMatchObject({
      userId: "owner-1",
      type: "COMPANY_INVITATION_DECLINED",
      title: "Invitation declined",
      resourceType: "COMPANY",
      resourceId: "company-1",
      actionUrl: "/dashboard/company/invitations",
    });
  });

  it("is a no-op when recipientUserId is null (defensive invited-email-has-no-account edge case)", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyCompanyInvitationStatusChangeSubscriber(notifications);

    await subscriber.handle(
      new CompanyInvitationStatusChanged(
        "invitation-1",
        "company-1",
        null,
        "owner-1",
        "PENDING",
        "CREATED",
        "MEMBER",
        "unregistered@example.com",
      ),
    );

    expect(notifications.events).toHaveLength(0);
  });

  it("propagates a notification-service failure rather than swallowing it — the EventBus owns the failure contract", async () => {
    const subscriber = new NotifyCompanyInvitationStatusChangeSubscriber(new ThrowingNotificationCreator());

    await expect(
      subscriber.handle(
        new CompanyInvitationStatusChanged(
          "invitation-1",
          "company-1",
          "invitee-1",
          "owner-1",
          "PENDING",
          "CREATED",
          "MEMBER",
          "invitee@example.com",
        ),
      ),
    ).rejects.toThrow("notification service outage");
  });
});
