import { describe, expect, it } from "vitest";

import { NotifyCompanyMembershipChangeSubscriber } from "@/application/use-cases/notification/notify-company-membership-change.subscriber";
import { CompanyMembershipChanged } from "@/domain/events/company-membership-changed";
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

describe("application/use-cases/notification/notify-company-membership-change.subscriber", () => {
  it("notifies the target member with role-specific copy for a ROLE_CHANGED transition", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyCompanyMembershipChangeSubscriber(notifications);

    await subscriber.handle(
      new CompanyMembershipChanged("company-1", "member-1", "user-1", "owner-1", "ROLE_CHANGED", "MEMBER", "MANAGER"),
    );

    expect(notifications.events).toHaveLength(1);
    expect(notifications.events[0]).toMatchObject({
      userId: "user-1",
      type: "COMPANY_MEMBER_ROLE_CHANGED",
      title: "Your role has changed",
      message: "Your role in the company was changed to MANAGER.",
      resourceType: "COMPANY",
      resourceId: "company-1",
      actionUrl: "/dashboard/company/members",
    });
  });

  it("interpolates the new role into the message for a different ROLE_CHANGED transition", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyCompanyMembershipChangeSubscriber(notifications);

    await subscriber.handle(
      new CompanyMembershipChanged("company-1", "member-1", "user-1", "owner-1", "ROLE_CHANGED", "MANAGER", "ADMIN"),
    );

    expect(notifications.events[0]).toMatchObject({ message: "Your role in the company was changed to ADMIN." });
  });

  it("notifies the removed member with fixed copy for a REMOVED transition, including on self-removal", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyCompanyMembershipChangeSubscriber(notifications);

    await subscriber.handle(
      new CompanyMembershipChanged("company-1", "member-1", "user-1", "user-1", "REMOVED", "MEMBER", null, true),
    );

    expect(notifications.events[0]).toMatchObject({
      userId: "user-1",
      type: "COMPANY_MEMBER_REMOVED",
      title: "You have been removed from a company",
      message: "You are no longer a member of this company.",
      resourceType: "COMPANY",
      resourceId: "company-1",
    });
    expect(notifications.events[0]?.actionUrl).toBeUndefined();
  });

  it("notifies only the incoming owner for an OWNERSHIP_TRANSFERRED transition — the outgoing owner gets no notification", async () => {
    const notifications = new RecordingNotificationCreator();
    const subscriber = new NotifyCompanyMembershipChangeSubscriber(notifications);

    await subscriber.handle(
      new CompanyMembershipChanged("company-1", "member-2", "new-owner-1", "old-owner-1", "OWNERSHIP_TRANSFERRED"),
    );

    expect(notifications.events).toHaveLength(1);
    expect(notifications.events[0]).toMatchObject({
      userId: "new-owner-1",
      type: "COMPANY_MEMBER_ROLE_CHANGED",
      title: "You are now the company owner",
      message: "Ownership of the company has been transferred to you.",
      resourceType: "COMPANY",
      resourceId: "company-1",
      actionUrl: "/dashboard/company/profile",
    });
  });

  it("propagates a notification-service failure rather than swallowing it — the EventBus owns the failure contract", async () => {
    const subscriber = new NotifyCompanyMembershipChangeSubscriber(new ThrowingNotificationCreator());

    await expect(
      subscriber.handle(
        new CompanyMembershipChanged("company-1", "member-1", "user-1", "owner-1", "ROLE_CHANGED", "MEMBER", "MANAGER"),
      ),
    ).rejects.toThrow("notification service outage");
  });
});
