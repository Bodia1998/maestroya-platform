import { describe, expect, it, vi } from "vitest";

import type { NotificationChannel, NotificationChannelAdapter, NotificationChannelSendResult } from "@/application/ports/notification-channel";
import type { NotificationRequest } from "@/application/ports/notification-service";
import { NotificationDispatcher } from "@/infrastructure/notifications/notification-dispatcher";

/** Module 145 — the dispatcher's idempotency gate (and proof that the legacy path is unchanged). */
const request = (over: Partial<NotificationRequest> = {}): NotificationRequest => ({
  userId: "user-1",
  category: "INFORMATION",
  type: "LEAD_PURCHASE_CONFIRMED",
  title: "t",
  message: "m",
  ...over,
});

function adapter(channel: NotificationChannel, result: NotificationChannelSendResult = undefined, calls: string[] = []) {
  const send = vi.fn(async () => {
    calls.push(channel);
    return result;
  });
  return { channel, send } as NotificationChannelAdapter & { send: ReturnType<typeof vi.fn> };
}

describe("NotificationDispatcher — with a dedupeKey", () => {
  it("runs IN_APP first even when it is listed last, then the other channels", async () => {
    const calls: string[] = [];
    const dispatcher = new NotificationDispatcher([adapter("REALTIME", undefined, calls), adapter("IN_APP", { outcome: "DELIVERED" }, calls)]);
    await dispatcher.notify(request({ channels: ["REALTIME", "IN_APP"], dedupeKey: "k" }));
    expect(calls).toEqual(["IN_APP", "REALTIME"]);
  });

  it("a DUPLICATE from IN_APP skips every other channel (no second realtime/email/SMS for a replayed event)", async () => {
    const calls: string[] = [];
    const dispatcher = new NotificationDispatcher([
      adapter("IN_APP", { outcome: "DUPLICATE" }, calls),
      adapter("REALTIME", undefined, calls),
      adapter("EMAIL", undefined, calls),
    ]);
    await dispatcher.notify(request({ channels: ["IN_APP", "REALTIME", "EMAIL"], dedupeKey: "k" }));
    expect(calls).toEqual(["IN_APP"]);
  });

  it("passes the dedupeKey to the adapters", async () => {
    const inApp = adapter("IN_APP", { outcome: "DELIVERED" });
    await new NotificationDispatcher([inApp]).notify(request({ channels: ["IN_APP"], dedupeKey: "lead-v1:x" }));
    expect(inApp.send).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: "lead-v1:x" }));
  });

  it("if the ledger (IN_APP) fails, no other channel runs and the error is thrown (a retry must not double-deliver)", async () => {
    const realtime = adapter("REALTIME");
    const inApp = { channel: "IN_APP", send: vi.fn(async () => { throw new Error("db down"); }) } as unknown as NotificationChannelAdapter;
    await expect(new NotificationDispatcher([inApp, realtime]).notify(request({ channels: ["IN_APP", "REALTIME"], dedupeKey: "k" }))).rejects.toThrow("db down");
    expect(realtime.send).not.toHaveBeenCalled();
  });

  it("a key without the IN_APP channel is a programming error and sends nothing", async () => {
    const realtime = adapter("REALTIME");
    await expect(new NotificationDispatcher([realtime]).notify(request({ channels: ["REALTIME"], dedupeKey: "k" }))).rejects.toThrow(/IN_APP/);
    expect(realtime.send).not.toHaveBeenCalled();
  });
});

describe("NotificationDispatcher — without a dedupeKey (legacy behavior unchanged)", () => {
  it("keeps channel order, never adds a dedupeKey field, and ignores any outcome", async () => {
    const calls: string[] = [];
    const realtime = adapter("REALTIME", undefined, calls);
    const inApp = adapter("IN_APP", { outcome: "DUPLICATE" }, calls); // would only matter with a key
    await new NotificationDispatcher([inApp, realtime]).notify(request({ channels: ["REALTIME", "IN_APP"] }));
    expect(calls).toEqual(["REALTIME", "IN_APP"]);
    expect(inApp.send.mock.calls[0]![0]).not.toHaveProperty("dedupeKey");
  });

  it("a failing channel does not stop the others, and the first error is rethrown at the end", async () => {
    const realtime = adapter("REALTIME");
    const failing = { channel: "IN_APP", send: vi.fn(async () => { throw new Error("boom"); }) } as unknown as NotificationChannelAdapter;
    await expect(new NotificationDispatcher([failing, realtime]).notify(request({ channels: ["IN_APP", "REALTIME"] }))).rejects.toThrow("boom");
    expect(realtime.send).toHaveBeenCalledTimes(1);
  });

  it("defaults to IN_APP only", async () => {
    const calls: string[] = [];
    await new NotificationDispatcher([adapter("IN_APP", undefined, calls), adapter("REALTIME", undefined, calls)]).notify(request());
    expect(calls).toEqual(["IN_APP"]);
  });
});
