import { describe, expect, it, vi } from "vitest";

import { DisputeCreated } from "@/domain/events/dispute-created";
import { NotifyDisputeCreatedSmsSubscriber } from "@/application/use-cases/notification/notify-dispute-created-sms.subscriber";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import type { UserProfileRecord, UserRepository } from "@/domain/repositories/user-repository";

function profile(overrides: Partial<UserProfileRecord> = {}): UserProfileRecord {
  return {
    id: "user-1",
    name: "Ana",
    email: "ana@example.com",
    phone: "+34600000000",
    image: null,
    timezone: null,
    notificationPreferences: null,
    preferredLanguageId: null,
    status: "ACTIVE",
    hasPassword: true,
    ...overrides,
  };
}

function fakeUsers(overrides: Partial<UserRepository> = {}): UserRepository {
  return {
    findByEmail: async () => null,
    findById: async () => null,
    createWithPassword: async () => {
      throw new Error("not used");
    },
    updatePasswordHash: async () => {},
    markEmailVerified: async () => {},
    updateLastLoginAt: async () => {},
    getRoleKeys: async () => [],
    assignDefaultRole: async () => {},
    getSignupIntent: async () => null,
    clearSignupIntent: async () => {},
    findProfileById: async () => profile(),
    updateProfile: async () => {},
    updateAvatar: async () => {},
    softDeleteAccount: async () => {},
    getPreferredLocale: async () => "en",
    updatePreferredLocale: async () => {},
    ...overrides,
  };
}

describe("NotifyDisputeCreatedSmsSubscriber", () => {
  it("notifies each recipient over SMS with the resolved phone and locale", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const notifications: NotificationCreator = { notify };
    const subscriber = new NotifyDisputeCreatedSmsSubscriber(notifications, fakeUsers());

    const event = new DisputeCreated("dispute-1", "D-1001", "job-1", "OTHER", "actor-1", ["user-1", "user-2"]);
    await subscriber.handle(event);

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        phone: "+34600000000",
        locale: "en",
        channels: ["SMS"],
        type: "DISPUTE_CREATED",
      }),
    );
  });

  it("skips a recipient with no phone on file", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const notifications: NotificationCreator = { notify };
    const users = fakeUsers({ findProfileById: async () => profile({ phone: null }) });
    const subscriber = new NotifyDisputeCreatedSmsSubscriber(notifications, users);

    await subscriber.handle(new DisputeCreated("dispute-1", "D-1001", "job-1", "OTHER", "actor-1", ["user-1"]));

    expect(notify).not.toHaveBeenCalled();
  });

  it("skips a recipient when the profile lookup fails, without breaking the loop for others", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const notifications: NotificationCreator = { notify };
    const users = fakeUsers({
      findProfileById: vi
        .fn()
        .mockRejectedValueOnce(new Error("db down"))
        .mockResolvedValueOnce(profile({ id: "user-2" })),
    });
    const subscriber = new NotifyDisputeCreatedSmsSubscriber(notifications, users);

    await subscriber.handle(new DisputeCreated("dispute-1", "D-1001", "job-1", "OTHER", "actor-1", ["user-1", "user-2"]));

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-2" }));
  });

  it("does nothing for an event with no recipients", async () => {
    const notify = vi.fn();
    const subscriber = new NotifyDisputeCreatedSmsSubscriber({ notify }, fakeUsers());
    await subscriber.handle(new DisputeCreated("dispute-1", "D-1001", "job-1", "OTHER", "actor-1", []));
    expect(notify).not.toHaveBeenCalled();
  });
});
