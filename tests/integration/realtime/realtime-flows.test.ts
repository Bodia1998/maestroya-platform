import { describe, expect, it } from "vitest";

import { RealtimeHub } from "@/application/services/realtime/realtime-hub";
import { RealtimeMetrics } from "@/application/services/realtime/realtime-metrics";
import { ChannelAuthorizationService } from "@/application/services/realtime/channel-authorization.service";
import { InMemoryConnectionRegistry } from "@/infrastructure/realtime/in-memory-connection-registry";
import { InMemoryPresenceStore } from "@/infrastructure/realtime/in-memory-presence-store";
import { SubscribeToChannelUseCase } from "@/application/use-cases/realtime/subscribe-to-channel.use-case";
import { UnsubscribeFromChannelUseCase } from "@/application/use-cases/realtime/unsubscribe-from-channel.use-case";
import { PublishToChannelUseCase } from "@/application/use-cases/realtime/publish-to-channel.use-case";
import { RecordHeartbeatUseCase } from "@/application/use-cases/realtime/record-heartbeat.use-case";
import { GetPresenceUseCase } from "@/application/use-cases/realtime/get-presence.use-case";
import { RecordingAccessChecker, recordingSink } from "./fakes";

/**
 * End-to-end flows through the full realtime stack — CQRS use cases →
 * `RealtimeHub` → in-memory `ConnectionRegistry`/`PresenceStore` — with a
 * fake `RealtimeAccessChecker` standing in for the Prisma-backed one
 * (deliberately: authorization *policy* is already covered by
 * `channel-authorization.service.test.ts`; this suite is about the wiring
 * end to end).
 */
function makeStack() {
  const registry = new InMemoryConnectionRegistry();
  const presence = new InMemoryPresenceStore();
  const accessChecker = new RecordingAccessChecker();
  const hub = new RealtimeHub(registry, presence, new ChannelAuthorizationService(accessChecker), new RealtimeMetrics());

  return {
    hub,
    registry,
    accessChecker,
    subscribe: new SubscribeToChannelUseCase(hub),
    unsubscribe: new UnsubscribeFromChannelUseCase(hub),
    publish: new PublishToChannelUseCase(hub),
    heartbeat: new RecordHeartbeatUseCase(hub),
    presenceQuery: new GetPresenceUseCase(hub),
  };
}

describe("realtime integration: connect -> subscribe -> publish -> disconnect", () => {
  it("delivers a published event only to authorized, subscribed connections", async () => {
    const stack = makeStack();
    stack.accessChecker.allow("dispute", "customer-1", "d1");

    const customerSink = recordingSink();
    const adminSink = recordingSink();
    const outsiderSink = recordingSink();

    const customer = stack.hub.connect({ userId: "customer-1", roles: ["CUSTOMER"], transport: "SSE", sink: customerSink.sink });
    const admin = stack.hub.connect({ userId: "admin-1", roles: ["ADMIN"], transport: "WS", sink: adminSink.sink });
    const outsider = stack.hub.connect({ userId: "outsider-1", roles: ["CUSTOMER"], transport: "SSE", sink: outsiderSink.sink });

    await stack.subscribe.execute({ connectionId: customer.id, channel: "dispute:d1" });
    await stack.subscribe.execute({ connectionId: admin.id, channel: "dispute:d1" });
    await expect(stack.subscribe.execute({ connectionId: outsider.id, channel: "dispute:d1" })).rejects.toThrow();

    const { deliveredTo } = stack.publish.execute({ channel: "dispute:d1", type: "dispute.message-added", payload: { messageId: "m1" } });

    expect(deliveredTo).toBe(2);
    expect(customerSink.received).toHaveLength(1);
    expect(adminSink.received).toHaveLength(1);
    expect(outsiderSink.received).toHaveLength(0);
  });

  it("presence reflects connect/disconnect and is readable by the user themselves and by staff, not by strangers", () => {
    const stack = makeStack();
    const sink = recordingSink();
    const connection = stack.hub.connect({ userId: "u1", roles: ["CUSTOMER"], transport: "SSE", sink: sink.sink });

    expect(stack.presenceQuery.execute({ requestedByUserId: "u1", requestedByRoles: ["CUSTOMER"], targetUserId: "u1" }).status).toBe("ONLINE");
    expect(stack.presenceQuery.execute({ requestedByUserId: "admin-1", requestedByRoles: ["ADMIN"], targetUserId: "u1" }).status).toBe("ONLINE");
    expect(() =>
      stack.presenceQuery.execute({ requestedByUserId: "stranger", requestedByRoles: ["CUSTOMER"], targetUserId: "u1" }),
    ).toThrow();

    stack.hub.disconnect(connection.id);

    expect(stack.presenceQuery.execute({ requestedByUserId: "u1", requestedByRoles: ["CUSTOMER"], targetUserId: "u1" }).status).toBe("OFFLINE");
  });

  it("unsubscribe stops further delivery without disconnecting the client", async () => {
    const stack = makeStack();
    stack.accessChecker.allow("chat", "u1", "c1");
    const sink = recordingSink();
    const connection = stack.hub.connect({ userId: "u1", roles: ["CUSTOMER"], transport: "SSE", sink: sink.sink });
    await stack.subscribe.execute({ connectionId: connection.id, channel: "chat:c1" });

    stack.unsubscribe.execute({ connectionId: connection.id, channel: "chat:c1" });
    stack.publish.execute({ channel: "chat:c1", type: "chat.message", payload: {} });

    expect(sink.received).toHaveLength(0);
    expect(stack.registry.get(connection.id)).not.toBeNull();
  });

  it("heartbeat keeps a connection alive across a reap sweep", () => {
    const stack = makeStack();
    const sink = recordingSink();
    const connection = stack.hub.connect({ userId: "u1", roles: ["CUSTOMER"], transport: "SSE", sink: sink.sink });
    const now = new Date("2026-01-01T00:00:10.000Z");

    stack.heartbeat.execute({ connectionId: connection.id });
    connection.recordHeartbeat(now);

    const evicted = stack.hub.reapExpired(5000, now);

    expect(evicted).toBe(0);
    expect(stack.registry.get(connection.id)).not.toBeNull();
  });

  it("a connection with no heartbeat within the TTL is reaped and its sink is not delivered to again", () => {
    const stack = makeStack();
    stack.accessChecker.allow("chat", "u1", "c1");
    const sink = recordingSink();
    const connection = stack.hub.connect({ userId: "u1", roles: ["CUSTOMER"], transport: "SSE", sink: sink.sink });
    return stack.subscribe.execute({ connectionId: connection.id, channel: "chat:c1" }).then(() => {
      const later = new Date(connection.connectedAt.getTime() + 120_000);
      stack.hub.reapExpired(5000, later);
      stack.publish.execute({ channel: "chat:c1", type: "chat.message", payload: {} });
      expect(sink.received).toHaveLength(0);
    });
  });
});
