import { describe, expect, it } from "vitest";

import { InMemoryPresenceStore } from "@/infrastructure/realtime/in-memory-presence-store";

describe("infrastructure/realtime/in-memory-presence-store", () => {
  it("reports OFFLINE with no lastSeenAt for a user never seen", () => {
    const store = new InMemoryPresenceStore();
    const snapshot = store.getSnapshot("u1");
    expect(snapshot).toEqual({ userId: "u1", status: "OFFLINE", activeConnectionCount: 0, lastSeenAt: null });
  });

  it("marks a user ONLINE with one active connection", () => {
    const store = new InMemoryPresenceStore();
    store.markOnline("u1", "conn-1");
    const snapshot = store.getSnapshot("u1");
    expect(snapshot.status).toBe("ONLINE");
    expect(snapshot.activeConnectionCount).toBe(1);
  });

  it("stays ONLINE across multiple devices until the last one disconnects", () => {
    const store = new InMemoryPresenceStore();
    store.markOnline("u1", "conn-1");
    store.markOnline("u1", "conn-2");
    expect(store.getSnapshot("u1").activeConnectionCount).toBe(2);

    store.markOffline("u1", "conn-1");
    expect(store.getSnapshot("u1").status).toBe("ONLINE");
    expect(store.getSnapshot("u1").activeConnectionCount).toBe(1);

    store.markOffline("u1", "conn-2");
    expect(store.getSnapshot("u1").status).toBe("OFFLINE");
    expect(store.getSnapshot("u1").activeConnectionCount).toBe(0);
  });

  it("records lastSeenAt on disconnect", () => {
    const store = new InMemoryPresenceStore();
    const onlineAt = new Date("2026-01-01T00:00:00.000Z");
    const offlineAt = new Date("2026-01-01T01:00:00.000Z");
    store.markOnline("u1", "conn-1", onlineAt);
    store.markOffline("u1", "conn-1", offlineAt);

    expect(store.getSnapshot("u1").lastSeenAt).toEqual(offlineAt);
  });

  it("listOnlineUserIds returns only users with at least one active connection", () => {
    const store = new InMemoryPresenceStore();
    store.markOnline("u1", "conn-1");
    store.markOnline("u2", "conn-2");
    store.markOffline("u2", "conn-2");

    expect(store.listOnlineUserIds()).toEqual(["u1"]);
  });
});
