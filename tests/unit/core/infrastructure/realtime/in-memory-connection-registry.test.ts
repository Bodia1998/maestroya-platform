import { describe, expect, it, vi } from "vitest";

import { InMemoryConnectionRegistry } from "@/infrastructure/realtime/in-memory-connection-registry";
import { RealtimeConnection } from "@/domain/entities/realtime-connection";
import type { RealtimeSink } from "@/application/ports/realtime-registry";

function makeConnection(id: string, userId: string) {
  return new RealtimeConnection({ id, userId, roles: [], transport: "SSE" });
}

function makeSink(): { sink: RealtimeSink; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn();
  return { sink: { send, close: vi.fn() }, send };
}

describe("infrastructure/realtime/in-memory-connection-registry", () => {
  it("registers and retrieves a connection", () => {
    const registry = new InMemoryConnectionRegistry();
    const connection = makeConnection("c1", "u1");
    registry.register(connection, makeSink().sink);

    expect(registry.get("c1")).toBe(connection);
    expect(registry.count()).toBe(1);
  });

  it("indexes connections by channel and by user", () => {
    const registry = new InMemoryConnectionRegistry();
    const a = makeConnection("a", "u1");
    const b = makeConnection("b", "u1");
    registry.register(a, makeSink().sink);
    registry.register(b, makeSink().sink);

    registry.subscribe("a", "chat:1");
    registry.subscribe("b", "chat:1");

    expect(registry.listByChannel("chat:1").map((c) => c.id).sort()).toEqual(["a", "b"]);
    expect(registry.listByUser("u1").map((c) => c.id).sort()).toEqual(["a", "b"]);
  });

  it("unregister removes a connection from every index", () => {
    const registry = new InMemoryConnectionRegistry();
    const a = makeConnection("a", "u1");
    registry.register(a, makeSink().sink);
    registry.subscribe("a", "chat:1");

    registry.unregister("a");

    expect(registry.get("a")).toBeNull();
    expect(registry.listByChannel("chat:1")).toEqual([]);
    expect(registry.listByUser("u1")).toEqual([]);
  });

  it("deliver() calls the registered sink and returns true", () => {
    const registry = new InMemoryConnectionRegistry();
    const a = makeConnection("a", "u1");
    const { sink, send } = makeSink();
    registry.register(a, sink);

    const event = { id: "e1", type: "test", channel: "chat:1", payload: {}, occurredAt: new Date().toISOString() };
    const ok = registry.deliver("a", event);

    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledWith(event);
  });

  it("deliver() returns false for an unknown connection and never throws", () => {
    const registry = new InMemoryConnectionRegistry();
    const event = { id: "e1", type: "test", channel: "chat:1", payload: {}, occurredAt: new Date().toISOString() };
    expect(registry.deliver("missing", event)).toBe(false);
  });

  it("deliver() returns false (not throw) when the sink itself throws", () => {
    const registry = new InMemoryConnectionRegistry();
    const a = makeConnection("a", "u1");
    registry.register(a, {
      send: () => {
        throw new Error("boom");
      },
      close: vi.fn(),
    });

    const event = { id: "e1", type: "test", channel: "chat:1", payload: {}, occurredAt: new Date().toISOString() };
    expect(registry.deliver("a", event)).toBe(false);
  });

  it("unsubscribe() removes a single channel membership without affecting others", () => {
    const registry = new InMemoryConnectionRegistry();
    const a = makeConnection("a", "u1");
    registry.register(a, makeSink().sink);
    registry.subscribe("a", "chat:1");
    registry.subscribe("a", "chat:2");

    registry.unsubscribe("a", "chat:1");

    expect(registry.listByChannel("chat:1")).toEqual([]);
    expect(registry.listByChannel("chat:2").map((c) => c.id)).toEqual(["a"]);
  });
});
