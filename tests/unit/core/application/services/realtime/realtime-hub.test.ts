import { describe, expect, it, vi } from "vitest";

import { RealtimeHub } from "@/application/services/realtime/realtime-hub";
import { RealtimeMetrics } from "@/application/services/realtime/realtime-metrics";
import { ChannelAuthorizationService } from "@/application/services/realtime/channel-authorization.service";
import { InMemoryConnectionRegistry } from "@/infrastructure/realtime/in-memory-connection-registry";
import { InMemoryPresenceStore } from "@/infrastructure/realtime/in-memory-presence-store";
import type { RealtimeAccessChecker } from "@/application/ports/realtime-access-checker";
import type { RealtimeSink } from "@/application/ports/realtime-registry";

class AllowAllAccessChecker implements RealtimeAccessChecker {
  isJobParticipant = () => Promise.resolve(true);
  isDisputeParticipant = () => Promise.resolve(true);
  isConversationParticipant = () => Promise.resolve(true);
  isCompanyMember = () => Promise.resolve(true);
  isProfessionalOwner = () => Promise.resolve(true);
}

function makeHub() {
  const registry = new InMemoryConnectionRegistry();
  const presence = new InMemoryPresenceStore();
  const authorization = new ChannelAuthorizationService(new AllowAllAccessChecker());
  const metrics = new RealtimeMetrics();
  return { hub: new RealtimeHub(registry, presence, authorization, metrics), registry, presence };
}

function fakeSink(): { sink: RealtimeSink; received: unknown[] } {
  const received: unknown[] = [];
  return {
    received,
    sink: {
      send: (event) => received.push(event),
      close: vi.fn(),
    },
  };
}

describe("application/services/realtime/realtime-hub", () => {
  it("connect() registers a connection and marks the user online", () => {
    const { hub, presence } = makeHub();
    const { sink } = fakeSink();

    const connection = hub.connect({ userId: "u1", roles: ["CUSTOMER"], transport: "SSE", sink });

    expect(connection.userId).toBe("u1");
    expect(presence.getSnapshot("u1").status).toBe("ONLINE");
  });

  it("subscribe() enforces authorization and records the channel on the connection", async () => {
    const { hub } = makeHub();
    const { sink } = fakeSink();
    const connection = hub.connect({ userId: "u1", roles: ["CUSTOMER"], transport: "SSE", sink });

    const channel = await hub.subscribe(connection.id, "dispute:d1");

    expect(channel.toString()).toBe("dispute:d1");
    expect(connection.isSubscribedTo("dispute:d1")).toBe(true);
  });

  it("subscribe() rejects an unauthorized channel", async () => {
    const registry = new InMemoryConnectionRegistry();
    const presence = new InMemoryPresenceStore();
    const denyAll: RealtimeAccessChecker = {
      isJobParticipant: () => Promise.resolve(false),
      isDisputeParticipant: () => Promise.resolve(false),
      isConversationParticipant: () => Promise.resolve(false),
      isCompanyMember: () => Promise.resolve(false),
      isProfessionalOwner: () => Promise.resolve(false),
    };
    const hub = new RealtimeHub(registry, presence, new ChannelAuthorizationService(denyAll), new RealtimeMetrics());
    const { sink } = fakeSink();
    const connection = hub.connect({ userId: "u1", roles: ["CUSTOMER"], transport: "SSE", sink });

    await expect(hub.subscribe(connection.id, "dispute:d1")).rejects.toThrow();
  });

  it("subscribe() rejects an unknown connection id", async () => {
    const { hub } = makeHub();
    await expect(hub.subscribe("does-not-exist", "admin")).rejects.toThrow();
  });

  it("publish() delivers only to subscribers of that channel", async () => {
    const { hub } = makeHub();
    const subscriber = fakeSink();
    const bystander = fakeSink();

    const subscriberConn = hub.connect({ userId: "u1", roles: ["CUSTOMER"], transport: "SSE", sink: subscriber.sink });
    hub.connect({ userId: "u2", roles: ["CUSTOMER"], transport: "SSE", sink: bystander.sink });
    await hub.subscribe(subscriberConn.id, "dispute:d1");

    const deliveredTo = hub.publish("dispute:d1", "dispute.created", { disputeId: "d1" });

    expect(deliveredTo).toBe(1);
    expect(subscriber.received).toHaveLength(1);
    expect(bystander.received).toHaveLength(0);
  });

  it("disconnect() marks the user offline once their last connection ends", () => {
    const { hub, presence } = makeHub();
    const { sink } = fakeSink();
    const connection = hub.connect({ userId: "u1", roles: ["CUSTOMER"], transport: "SSE", sink });

    hub.disconnect(connection.id);

    expect(presence.getSnapshot("u1").status).toBe("OFFLINE");
  });

  it("heartbeat() returns false for an unknown connection and true otherwise", () => {
    const { hub } = makeHub();
    const { sink } = fakeSink();
    const connection = hub.connect({ userId: "u1", roles: ["CUSTOMER"], transport: "SSE", sink });

    expect(hub.heartbeat("nope")).toBe(false);
    expect(hub.heartbeat(connection.id)).toBe(true);
  });

  it("reapExpired() evicts stale connections and leaves fresh ones", () => {
    const { hub, registry } = makeHub();
    const stale = fakeSink();
    const fresh = fakeSink();
    const now = new Date("2026-01-01T00:00:00.000Z");

    const staleConn = hub.connect({ userId: "u1", roles: ["CUSTOMER"], transport: "SSE", sink: stale.sink });
    staleConn.recordHeartbeat(new Date(now.getTime() - 10_000));
    const freshConn = hub.connect({ userId: "u2", roles: ["CUSTOMER"], transport: "SSE", sink: fresh.sink });
    freshConn.recordHeartbeat(now);

    const evicted = hub.reapExpired(5000, now);

    expect(evicted).toBe(1);
    expect(registry.get(staleConn.id)).toBeNull();
    expect(registry.get(freshConn.id)).not.toBeNull();
  });
});
