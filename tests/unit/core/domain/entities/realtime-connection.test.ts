import { describe, expect, it } from "vitest";

import { RealtimeConnection } from "@/domain/entities/realtime-connection";

describe("domain/entities/realtime-connection", () => {
  function makeConnection() {
    return new RealtimeConnection({ id: "conn-1", userId: "user-1", roles: ["CUSTOMER"], transport: "SSE" });
  }

  it("starts with no channel subscriptions", () => {
    const connection = makeConnection();
    expect(connection.channels.size).toBe(0);
    expect(connection.isSubscribedTo("chat:1")).toBe(false);
  });

  it("tracks subscribe/unsubscribe", () => {
    const connection = makeConnection();
    connection.subscribe("chat:1");
    expect(connection.isSubscribedTo("chat:1")).toBe(true);
    connection.unsubscribe("chat:1");
    expect(connection.isSubscribedTo("chat:1")).toBe(false);
  });

  it("recordHeartbeat updates lastHeartbeatAt", () => {
    const connection = makeConnection();
    const initial = connection.lastHeartbeatAt;
    const later = new Date(initial.getTime() + 1000);
    connection.recordHeartbeat(later);
    expect(connection.lastHeartbeatAt).toBe(later);
  });

  it("isExpired compares against ttl from lastHeartbeatAt", () => {
    const connection = makeConnection();
    const start = connection.lastHeartbeatAt;
    expect(connection.isExpired(1000, new Date(start.getTime() + 500))).toBe(false);
    expect(connection.isExpired(1000, new Date(start.getTime() + 1500))).toBe(true);
  });
});
