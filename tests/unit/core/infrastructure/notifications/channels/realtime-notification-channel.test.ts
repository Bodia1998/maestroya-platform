import { describe, expect, it, vi } from "vitest";

import { RealTimeNotificationChannel } from "@/infrastructure/notifications/channels/realtime-notification-channel";
import type { PublishToChannelUseCase } from "@/application/use-cases/realtime/publish-to-channel.use-case";

describe("infrastructure/notifications/channels/realtime-notification-channel", () => {
  it("declares the REALTIME channel", () => {
    const channel = new RealTimeNotificationChannel({ execute: vi.fn() } as unknown as PublishToChannelUseCase);
    expect(channel.channel).toBe("REALTIME");
  });

  it("publishes onto the recipient's user:{id} channel", async () => {
    const execute = vi.fn().mockReturnValue({ deliveredTo: 1 });
    const channel = new RealTimeNotificationChannel({ execute } as unknown as PublishToChannelUseCase);

    await channel.send({
      userId: "u1",
      category: "INFORMATION",
      type: "DISPUTE_CREATED",
      title: "New dispute",
      message: "A dispute was opened.",
      resourceType: "DISPUTE",
      resourceId: "d1",
      actionUrl: "/disputes/d1",
      metadata: { foo: "bar" },
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "user:u1",
        type: "notification",
        payload: expect.objectContaining({ title: "New dispute", resourceId: "d1" }),
      }),
    );
  });

  it("is a no-op delivery (not an error) when the recipient has no live connection", async () => {
    // RealtimeHub.publish() returns 0 delivered — not an error — when
    // nobody is subscribed to the channel; this adapter's contract is
    // "attempt delivery", not "guarantee a live recipient".
    const execute = vi.fn().mockReturnValue({ deliveredTo: 0 });
    const channel = new RealTimeNotificationChannel({ execute } as unknown as PublishToChannelUseCase);

    await expect(
      channel.send({ userId: "u1", category: "INFORMATION", type: "DISPUTE_CREATED", title: "t", message: "m" }),
    ).resolves.toBeUndefined();
  });
});
