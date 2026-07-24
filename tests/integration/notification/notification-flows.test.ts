import { describe, expect, it } from "vitest";

import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { CreateNotificationUseCase } from "@/application/use-cases/notification/create-notification.use-case";
import { DismissNotificationUseCase } from "@/application/use-cases/notification/dismiss-notification.use-case";
import { GetNotificationUseCase } from "@/application/use-cases/notification/get-notification.use-case";
import { GetUnreadNotificationCountUseCase } from "@/application/use-cases/notification/get-unread-notification-count.use-case";
import { ListNotificationsUseCase } from "@/application/use-cases/notification/list-notifications.use-case";
import { MarkAllNotificationsAsReadUseCase } from "@/application/use-cases/notification/mark-all-notifications-as-read.use-case";
import { MarkNotificationAsReadUseCase } from "@/application/use-cases/notification/mark-notification-as-read.use-case";
import { FakeNotificationRepository } from "./fakes";

/**
 * Integration tests for the Notifications module (Module 15): real use
 * cases + domain services, a fake repository swapped in for storage — same
 * pattern as every other module's integration tests (see
 * tests/integration/review/review-flows.test.ts).
 */

const USER_A = "user-a";
const USER_B = "user-b";

function makeUseCases(notifications: FakeNotificationRepository) {
  return {
    create: new CreateNotificationUseCase(notifications),
    list: new ListNotificationsUseCase(notifications),
    get: new GetNotificationUseCase(notifications),
    unreadCount: new GetUnreadNotificationCountUseCase(notifications),
    markAsRead: new MarkNotificationAsReadUseCase(notifications),
    markAllAsRead: new MarkAllNotificationsAsReadUseCase(notifications),
    dismiss: new DismissNotificationUseCase(notifications),
  };
}

async function seedNotification(
  create: CreateNotificationUseCase,
  overrides: Partial<Parameters<CreateNotificationUseCase["execute"]>[0]> = {},
) {
  return create.execute({
    userId: USER_A,
    type: "NEW_MESSAGE",
    title: "New message",
    message: "You have a new message.",
    ...overrides,
  });
}

describe("Create Notification — validation", () => {
  it("creates a notification with every optional field populated", async () => {
    const notifications = new FakeNotificationRepository();
    const { create } = makeUseCases(notifications);

    const notification = await create.execute({
      userId: USER_A,
      type: "REVIEW_RECEIVED",
      title: "You received a new review",
      message: "A customer left a review for your completed job.",
      resourceType: "REVIEW",
      resourceId: "review-1",
      actionUrl: "/jobs/job-1",
      metadata: { jobId: "job-1", rating: 5 },
    });

    expect(notification.userId).toBe(USER_A);
    expect(notification.type).toBe("REVIEW_RECEIVED");
    expect(notification.resourceType).toBe("REVIEW");
    expect(notification.resourceId).toBe("review-1");
    expect(notification.actionUrl).toBe("/jobs/job-1");
    expect(notification.metadata).toEqual({ jobId: "job-1", rating: 5 });
    expect(notification.readAt).toBeNull();
    expect(notification.dismissedAt).toBeNull();
  });

  it("creates a notification with every optional field omitted", async () => {
    const notifications = new FakeNotificationRepository();
    const { create } = makeUseCases(notifications);

    const notification = await seedNotification(create);
    expect(notification.resourceType).toBeNull();
    expect(notification.resourceId).toBeNull();
    expect(notification.actionUrl).toBeNull();
    expect(notification.metadata).toBeNull();
  });

  it("rejects an empty title", async () => {
    const notifications = new FakeNotificationRepository();
    const { create } = makeUseCases(notifications);
    await expect(seedNotification(create, { title: "   " })).rejects.toThrow(ValidationError);
  });

  it("rejects a title over 200 characters", async () => {
    const notifications = new FakeNotificationRepository();
    const { create } = makeUseCases(notifications);
    await expect(seedNotification(create, { title: "a".repeat(201) })).rejects.toThrow(ValidationError);
  });

  it("rejects an empty message", async () => {
    const notifications = new FakeNotificationRepository();
    const { create } = makeUseCases(notifications);
    await expect(seedNotification(create, { message: "" })).rejects.toThrow(ValidationError);
  });

  it("rejects a message over 2000 characters", async () => {
    const notifications = new FakeNotificationRepository();
    const { create } = makeUseCases(notifications);
    await expect(seedNotification(create, { message: "a".repeat(2001) })).rejects.toThrow(ValidationError);
  });

  it("rejects an actionUrl that is an absolute external URL", async () => {
    const notifications = new FakeNotificationRepository();
    const { create } = makeUseCases(notifications);
    await expect(seedNotification(create, { actionUrl: "https://evil.example.com/phish" })).rejects.toThrow(
      ValidationError,
    );
  });

  it("rejects a javascript: actionUrl", async () => {
    const notifications = new FakeNotificationRepository();
    const { create } = makeUseCases(notifications);
    await expect(seedNotification(create, { actionUrl: "javascript:alert(1)" })).rejects.toThrow(ValidationError);
  });

  it("rejects a data: actionUrl", async () => {
    const notifications = new FakeNotificationRepository();
    const { create } = makeUseCases(notifications);
    await expect(seedNotification(create, { actionUrl: "data:text/html,<script>alert(1)</script>" })).rejects.toThrow(
      ValidationError,
    );
  });

  it("rejects a protocol-relative actionUrl", async () => {
    const notifications = new FakeNotificationRepository();
    const { create } = makeUseCases(notifications);
    await expect(seedNotification(create, { actionUrl: "//evil.example.com" })).rejects.toThrow(ValidationError);
  });

  it("accepts a safe internal actionUrl", async () => {
    const notifications = new FakeNotificationRepository();
    const { create } = makeUseCases(notifications);
    const notification = await seedNotification(create, { actionUrl: "/jobs/job-1" });
    expect(notification.actionUrl).toBe("/jobs/job-1");
  });
});

describe("User isolation", () => {
  it("listing only ever returns the caller's own notifications", async () => {
    const notifications = new FakeNotificationRepository();
    const { create, list } = makeUseCases(notifications);
    await seedNotification(create, { userId: USER_A });
    await seedNotification(create, { userId: USER_B });

    const listA = await list.execute(USER_A, { limit: 20, offset: 0 });
    const listB = await list.execute(USER_B, { limit: 20, offset: 0 });
    expect(listA).toHaveLength(1);
    expect(listB).toHaveLength(1);
    expect(listA[0]?.userId).toBe(USER_A);
    expect(listB[0]?.userId).toBe(USER_B);
  });

  it("getting another user's notification behaves as NotFoundError, not a distinguishable forbidden", async () => {
    const notifications = new FakeNotificationRepository();
    const { create, get } = makeUseCases(notifications);
    const notification = await seedNotification(create, { userId: USER_A });

    await expect(get.execute(USER_B, notification.id)).rejects.toThrow(NotFoundError);
  });

  it("a nonexistent notification id fails the same way for anyone (no existence probing)", async () => {
    const notifications = new FakeNotificationRepository();
    const { get } = makeUseCases(notifications);
    await expect(get.execute(USER_A, "does-not-exist")).rejects.toThrow(NotFoundError);
  });

  it("marking another user's notification as read behaves as NotFoundError", async () => {
    const notifications = new FakeNotificationRepository();
    const { create, markAsRead } = makeUseCases(notifications);
    const notification = await seedNotification(create, { userId: USER_A });

    await expect(markAsRead.execute(USER_B, notification.id)).rejects.toThrow(NotFoundError);
  });

  it("dismissing another user's notification behaves as NotFoundError", async () => {
    const notifications = new FakeNotificationRepository();
    const { create, dismiss } = makeUseCases(notifications);
    const notification = await seedNotification(create, { userId: USER_A });

    await expect(dismiss.execute(USER_B, notification.id)).rejects.toThrow(NotFoundError);
  });

  it("markAllAsRead for one user never touches another user's notifications", async () => {
    const notifications = new FakeNotificationRepository();
    const { create, markAllAsRead, unreadCount } = makeUseCases(notifications);
    await seedNotification(create, { userId: USER_A });
    await seedNotification(create, { userId: USER_B });

    await markAllAsRead.execute(USER_A);

    expect(await unreadCount.execute(USER_A)).toBe(0);
    expect(await unreadCount.execute(USER_B)).toBe(1);
  });
});

describe("Read/unread state", () => {
  it("a freshly created notification is unread", async () => {
    const notifications = new FakeNotificationRepository();
    const { create } = makeUseCases(notifications);
    const notification = await seedNotification(create);
    expect(notification.readAt).toBeNull();
  });

  it("marking as read sets readAt and is reflected in the unread count", async () => {
    const notifications = new FakeNotificationRepository();
    const { create, markAsRead, unreadCount } = makeUseCases(notifications);
    const notification = await seedNotification(create);

    expect(await unreadCount.execute(USER_A)).toBe(1);
    await markAsRead.execute(USER_A, notification.id);
    expect(await unreadCount.execute(USER_A)).toBe(0);
  });

  it("marking as read is idempotent", async () => {
    const notifications = new FakeNotificationRepository();
    const { create, markAsRead } = makeUseCases(notifications);
    const notification = await seedNotification(create);

    const first = await markAsRead.execute(USER_A, notification.id);
    const second = await markAsRead.execute(USER_A, notification.id);
    expect(first.readAt).not.toBeNull();
    expect(second.readAt).toEqual(first.readAt);
  });

  it("markAllAsRead marks every unread notification and is idempotent", async () => {
    const notifications = new FakeNotificationRepository();
    const { create, markAllAsRead, unreadCount } = makeUseCases(notifications);
    await seedNotification(create);
    await seedNotification(create);
    await seedNotification(create);

    expect(await unreadCount.execute(USER_A)).toBe(3);
    await markAllAsRead.execute(USER_A);
    expect(await unreadCount.execute(USER_A)).toBe(0);

    // Idempotent — calling again when nothing is unread is a harmless no-op.
    await markAllAsRead.execute(USER_A);
    expect(await unreadCount.execute(USER_A)).toBe(0);
  });

  it("unread count excludes dismissed notifications even if never marked read", async () => {
    const notifications = new FakeNotificationRepository();
    const { create, dismiss, unreadCount } = makeUseCases(notifications);
    const notification = await seedNotification(create);

    expect(await unreadCount.execute(USER_A)).toBe(1);
    await dismiss.execute(USER_A, notification.id);
    expect(await unreadCount.execute(USER_A)).toBe(0);
  });
});

describe("Dismissal", () => {
  it("dismissing sets dismissedAt", async () => {
    const notifications = new FakeNotificationRepository();
    const { create, dismiss } = makeUseCases(notifications);
    const notification = await seedNotification(create);

    const dismissed = await dismiss.execute(USER_A, notification.id);
    expect(dismissed.dismissedAt).not.toBeNull();
  });

  it("dismissing is idempotent", async () => {
    const notifications = new FakeNotificationRepository();
    const { create, dismiss } = makeUseCases(notifications);
    const notification = await seedNotification(create);

    const first = await dismiss.execute(USER_A, notification.id);
    const second = await dismiss.execute(USER_A, notification.id);
    expect(second.dismissedAt).toEqual(first.dismissedAt);
  });

  it("a dismissed notification is excluded from listings", async () => {
    const notifications = new FakeNotificationRepository();
    const { create, dismiss, list } = makeUseCases(notifications);
    const notification = await seedNotification(create);
    await dismiss.execute(USER_A, notification.id);

    const listed = await list.execute(USER_A, { limit: 20, offset: 0 });
    expect(listed).toHaveLength(0);
  });

  it("dismissal is a soft delete — the row is never hard-deleted", async () => {
    const notifications = new FakeNotificationRepository();
    const { create, dismiss } = makeUseCases(notifications);
    const notification = await seedNotification(create);
    await dismiss.execute(USER_A, notification.id);

    expect(notifications.notifications.has(notification.id)).toBe(true);
  });
});

describe("Pagination", () => {
  it("lists newest first", async () => {
    const notifications = new FakeNotificationRepository();
    const { create, list } = makeUseCases(notifications);
    const first = await seedNotification(create, { title: "First" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await seedNotification(create, { title: "Second" });

    const listed = await list.execute(USER_A, { limit: 20, offset: 0 });
    expect(listed.map((n) => n.id)).toEqual([second.id, first.id]);
  });

  it("respects limit and offset boundaries", async () => {
    const notifications = new FakeNotificationRepository();
    const { create, list } = makeUseCases(notifications);
    for (let i = 0; i < 5; i += 1) {
      await seedNotification(create, { title: `Notification ${i}` });
    }

    const page1 = await list.execute(USER_A, { limit: 2, offset: 0 });
    const page2 = await list.execute(USER_A, { limit: 2, offset: 2 });
    const page3 = await list.execute(USER_A, { limit: 2, offset: 4 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page3).toHaveLength(1);

    const ids = [...page1, ...page2, ...page3].map((n) => n.id);
    expect(new Set(ids).size).toBe(5);
  });

  it("an empty page beyond the end returns an empty array, not an error", async () => {
    const notifications = new FakeNotificationRepository();
    const { create, list } = makeUseCases(notifications);
    await seedNotification(create);

    const page = await list.execute(USER_A, { limit: 20, offset: 100 });
    expect(page).toEqual([]);
  });

  it("pagination is isolated per user", async () => {
    const notifications = new FakeNotificationRepository();
    const { create, list } = makeUseCases(notifications);
    await seedNotification(create, { userId: USER_A });
    await seedNotification(create, { userId: USER_A });
    await seedNotification(create, { userId: USER_B });

    const listA = await list.execute(USER_A, { limit: 20, offset: 0 });
    const listB = await list.execute(USER_B, { limit: 20, offset: 0 });
    expect(listA).toHaveLength(2);
    expect(listB).toHaveLength(1);
  });
});
