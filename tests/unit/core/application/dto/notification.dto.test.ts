import { describe, expect, it } from "vitest";

import {
  createNotificationSchema,
  dismissNotificationSchema,
  getNotificationSchema,
  listNotificationsSchema,
  markNotificationAsReadSchema,
} from "@/application/dto/notification.dto";

const VALID_USER_ID = "123e4567-e89b-12d3-a456-426614174000";
const VALID_NOTIFICATION_ID = "223e4567-e89b-12d3-a456-426614174000";

describe("createNotificationSchema", () => {
  it("accepts a full valid submission", () => {
    const result = createNotificationSchema.safeParse({
      userId: VALID_USER_ID,
      type: "NEW_QUOTE",
      title: "New quote received",
      message: "A professional submitted a quote for your service request.",
      resourceType: "QUOTE",
      resourceId: "quote-1",
      actionUrl: "/requests/req-1",
      metadata: { foo: "bar" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a submission with every optional field omitted", () => {
    const result = createNotificationSchema.safeParse({
      userId: VALID_USER_ID,
      type: "NEW_QUOTE",
      title: "New quote received",
      message: "A professional submitted a quote for your service request.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-UUID userId", () => {
    const result = createNotificationSchema.safeParse({
      userId: "not-a-uuid",
      type: "NEW_QUOTE",
      title: "Title",
      message: "Message",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid type", () => {
    const result = createNotificationSchema.safeParse({
      userId: VALID_USER_ID,
      type: "SOMETHING_ELSE",
      title: "Title",
      message: "Message",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing title", () => {
    const result = createNotificationSchema.safeParse({
      userId: VALID_USER_ID,
      type: "NEW_QUOTE",
      message: "Message",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a title over 200 characters", () => {
    const result = createNotificationSchema.safeParse({
      userId: VALID_USER_ID,
      type: "NEW_QUOTE",
      title: "a".repeat(201),
      message: "Message",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a message over 2000 characters", () => {
    const result = createNotificationSchema.safeParse({
      userId: VALID_USER_ID,
      type: "NEW_QUOTE",
      title: "Title",
      message: "a".repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unsafe actionUrl (external URL)", () => {
    const result = createNotificationSchema.safeParse({
      userId: VALID_USER_ID,
      type: "NEW_QUOTE",
      title: "Title",
      message: "Message",
      actionUrl: "https://example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a javascript: actionUrl", () => {
    const result = createNotificationSchema.safeParse({
      userId: VALID_USER_ID,
      type: "NEW_QUOTE",
      title: "Title",
      message: "Message",
      actionUrl: "javascript:alert(1)",
    });
    expect(result.success).toBe(false);
  });
});

describe("listNotificationsSchema", () => {
  it("applies default pagination", () => {
    const result = listNotificationsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.offset).toBe(0);
    }
  });

  it("rejects a limit above 100", () => {
    expect(listNotificationsSchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("rejects a limit of 0", () => {
    expect(listNotificationsSchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it("rejects a negative offset", () => {
    expect(listNotificationsSchema.safeParse({ offset: -1 }).success).toBe(false);
  });

  it("never accepts a userId field (recipient is always the session user)", () => {
    const parsed = listNotificationsSchema.parse({ userId: "some-other-id" } as never);
    expect(parsed).not.toHaveProperty("userId");
  });
});

describe("getNotificationSchema / markNotificationAsReadSchema / dismissNotificationSchema", () => {
  it("accepts a valid notification id", () => {
    expect(getNotificationSchema.safeParse({ id: VALID_NOTIFICATION_ID }).success).toBe(true);
    expect(markNotificationAsReadSchema.safeParse({ id: VALID_NOTIFICATION_ID }).success).toBe(true);
    expect(dismissNotificationSchema.safeParse({ id: VALID_NOTIFICATION_ID }).success).toBe(true);
  });

  it("rejects a non-UUID id", () => {
    expect(getNotificationSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
    expect(markNotificationAsReadSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
    expect(dismissNotificationSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
  });
});
