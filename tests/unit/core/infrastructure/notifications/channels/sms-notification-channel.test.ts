import { describe, expect, it, vi } from "vitest";

import type { SmsQueue } from "@/application/ports/sms-queue";
import { SmsNotificationChannel } from "@/infrastructure/notifications/channels/sms-notification-channel";

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    category: "INFORMATION" as const,
    type: "QUOTE_ACCEPTED" as const,
    title: "Quote accepted",
    message: "Your quote has been accepted.",
    resourceType: null,
    resourceId: null,
    actionUrl: null,
    metadata: null,
    ...overrides,
  };
}

describe("SmsNotificationChannel", () => {
  it("declares the SMS channel", () => {
    const channel = new SmsNotificationChannel({ enqueue: vi.fn() });
    expect(channel.channel).toBe("SMS");
  });

  it("enqueues onto the SmsQueue when a phone number is present", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const queue: SmsQueue = { enqueue };
    const channel = new SmsNotificationChannel(queue);

    await channel.send(basePayload({ phone: "+34600000000", locale: "es", metadata: { amount: "€10" } }));

    expect(enqueue).toHaveBeenCalledWith({
      userId: "user-1",
      phone: "+34600000000",
      type: "QUOTE_ACCEPTED",
      fallbackMessage: "Your quote has been accepted.",
      locale: "es",
      resourceType: null,
      resourceId: null,
      metadata: { amount: "€10" },
    });
  });

  it("is a safe no-op when no phone number is available — never throws, never enqueues", async () => {
    const enqueue = vi.fn();
    const channel = new SmsNotificationChannel({ enqueue });

    await expect(channel.send(basePayload({ phone: null }))).resolves.toBeUndefined();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("swallows an enqueue failure rather than throwing — must never fail the primary operation", async () => {
    const enqueue = vi.fn().mockRejectedValue(new Error("job store unreachable"));
    const channel = new SmsNotificationChannel({ enqueue });

    await expect(channel.send(basePayload({ phone: "+34600000000" }))).resolves.toBeUndefined();
  });
});
