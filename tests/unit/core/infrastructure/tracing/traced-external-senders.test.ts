import { describe, expect, it, vi } from "vitest";

import type { EmailSender } from "@/application/interfaces/email-sender";
import type { NotificationChannelAdapter, NotificationChannelPayload } from "@/application/ports/notification-channel";
import {
  TracedEmailSender,
  TracedNotificationChannel,
  withEmailTracing,
  withNotificationChannelTracing,
} from "@/infrastructure/tracing/traced-external-senders";
import { createFakeTracer } from "../../../../test-utils/fake-tracer";

function fakePayload(overrides: Partial<NotificationChannelPayload> = {}): NotificationChannelPayload {
  return {
    userId: "user-1",
    category: "SYSTEM" as never,
    type: "GENERIC" as never,
    title: "Hello",
    message: "World",
    ...overrides,
  };
}

describe("infrastructure/tracing/traced-external-senders", () => {
  describe("TracedEmailSender", () => {
    it("withEmailTracing returns the delegate untouched when tracing is disabled", () => {
      const tracer = createFakeTracer({ enabled: false });
      const delegate: EmailSender = { send: vi.fn() };
      expect(withEmailTracing(delegate, tracer)).toBe(delegate);
    });

    it("wraps in TracedEmailSender when enabled and delegates", async () => {
      const tracer = createFakeTracer();
      const delegate: EmailSender = { send: vi.fn().mockResolvedValue(undefined) };
      const traced = withEmailTracing(delegate, tracer, "resend");
      expect(traced).toBeInstanceOf(TracedEmailSender);

      const message = { to: "user@example.com", subject: "Verify your account", html: "<p>hi</p>" };
      await traced.send(message);

      expect(delegate.send).toHaveBeenCalledWith(message);
      const span = tracer.spans[0]!;
      expect(span.name).toBe("email.send");
      expect(span.kind).toBe("client");
      expect(span.attributes["external.system"]).toBe("resend");
      expect(span.attributes["email.subject"]).toBe("Verify your account");
      // Never the recipient address.
      expect(JSON.stringify(span.attributes)).not.toContain("user@example.com");
    });

    it("propagates a send failure unchanged", async () => {
      const tracer = createFakeTracer();
      const error = new Error("resend down");
      const delegate: EmailSender = { send: vi.fn().mockRejectedValue(error) };
      const traced = new TracedEmailSender(delegate, tracer, "resend");

      await expect(traced.send({ to: "a@b.com", subject: "s", html: "h" })).rejects.toBe(error);
    });
  });

  describe("TracedNotificationChannel", () => {
    it("withNotificationChannelTracing returns the delegate untouched when tracing is disabled", () => {
      const tracer = createFakeTracer({ enabled: false });
      const delegate: NotificationChannelAdapter = { channel: "REALTIME" as never, send: vi.fn() };
      expect(withNotificationChannelTracing(delegate, tracer)).toBe(delegate);
    });

    it("exposes the delegate's channel and traces send() with channel-specific attributes", async () => {
      const tracer = createFakeTracer();
      const delegate: NotificationChannelAdapter = {
        channel: "REALTIME" as never,
        send: vi.fn().mockResolvedValue(undefined),
      };
      const traced = withNotificationChannelTracing(delegate, tracer);
      expect(traced).toBeInstanceOf(TracedNotificationChannel);
      expect(traced.channel).toBe("REALTIME");

      const payload = fakePayload();
      await traced.send(payload);

      expect(delegate.send).toHaveBeenCalledWith(payload);
      const span = tracer.spans[0]!;
      expect(span.name).toBe("notification.send REALTIME");
      expect(span.attributes["notification.channel"]).toBe("REALTIME");
      expect(span.attributes["notification.category"]).toBe("SYSTEM");
    });

    it("does not swallow a delegate error (adapters must not silently succeed)", async () => {
      const tracer = createFakeTracer();
      const error = new Error("gateway unreachable");
      const delegate: NotificationChannelAdapter = { channel: "REALTIME" as never, send: vi.fn().mockRejectedValue(error) };
      const traced = new TracedNotificationChannel(delegate, tracer);

      await expect(traced.send(fakePayload())).rejects.toBe(error);
    });
  });
});
