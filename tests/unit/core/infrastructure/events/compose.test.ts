import { describe, expect, it, vi } from "vitest";

import { eventBus, makeEventBus } from "@/infrastructure/events/compose";
import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import { DomainEvent } from "@/domain/events/domain-event";

class PingEvent extends DomainEvent {
  static readonly eventName = "ping";
  constructor() {
    super();
  }
}

describe("infrastructure/events/compose", () => {
  it("exports eventBus as the one SynchronousEventBus instance in the composition root", () => {
    expect(eventBus).toBeInstanceOf(SynchronousEventBus);
  });

  it("makeEventBus returns the same shared instance every call", () => {
    expect(makeEventBus()).toBe(eventBus);
    expect(makeEventBus()).toBe(makeEventBus());
  });

  it("a handler subscribed via the shared instance receives events published through it later", async () => {
    const handler = vi.fn();
    eventBus.subscribe(PingEvent, { handle: handler });

    await eventBus.publish(new PingEvent());

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
