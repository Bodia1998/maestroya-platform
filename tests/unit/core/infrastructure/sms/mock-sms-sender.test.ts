import { describe, expect, it } from "vitest";

import { MockSmsSender } from "@/infrastructure/sms/mock-sms-sender";

describe("MockSmsSender", () => {
  it("records every message sent, oldest first", async () => {
    const sender = new MockSmsSender();

    await sender.send({ to: "+34600000001", body: "first" });
    await sender.send({ to: "+34600000002", body: "second" });

    expect(sender.messages).toEqual([
      { to: "+34600000001", body: "first" },
      { to: "+34600000002", body: "second" },
    ]);
    expect(sender.lastMessage).toEqual({ to: "+34600000002", body: "second" });
  });

  it("returns null for lastMessage before anything has been sent", () => {
    expect(new MockSmsSender().lastMessage).toBeNull();
  });

  it("returns a defensive copy from `messages` — mutating it does not affect the sender", async () => {
    const sender = new MockSmsSender();
    await sender.send({ to: "+34600000001", body: "first" });

    const snapshot = sender.messages as { to: string; body: string }[];
    snapshot.push({ to: "+34600000099", body: "injected" });

    expect(sender.messages).toHaveLength(1);
  });

  it("clear() empties the recorded history", async () => {
    const sender = new MockSmsSender();
    await sender.send({ to: "+34600000001", body: "first" });
    sender.clear();
    expect(sender.messages).toEqual([]);
    expect(sender.lastMessage).toBeNull();
  });
});
