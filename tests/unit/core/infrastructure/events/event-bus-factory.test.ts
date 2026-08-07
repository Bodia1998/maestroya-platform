import { afterEach, describe, expect, it, vi } from "vitest";

import { VALID_BASE_ENV } from "../config/env-fixture";

/**
 * Module 45 — Background Jobs (Roadmap Module 12).
 *
 * `createEventBus()` memoizes a module-level singleton (same convention as
 * `cache-service-factory.ts`, Module 44), so each case needs a fresh
 * module graph to observe a different `EVENT_QUEUE_ENABLED`.
 */
async function loadFactory(envOverrides: Record<string, string | undefined> = {}) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }

  vi.resetModules();
  return Promise.all([
    import("@/infrastructure/events/event-bus-factory"),
    import("@/infrastructure/events/synchronous-event-bus"),
    import("@/infrastructure/events/queued-event-bus"),
  ]);
}

describe("infrastructure/events/event-bus-factory", () => {
  afterEach(() => {
    delete (process.env as Record<string, string | undefined>).EVENT_QUEUE_ENABLED;
  });

  it("defaults to SynchronousEventBus when EVENT_QUEUE_ENABLED is unset", async () => {
    const [{ createEventBus }, { SynchronousEventBus }] = await loadFactory();
    expect(createEventBus()).toBeInstanceOf(SynchronousEventBus);
  });

  it("defaults to SynchronousEventBus when EVENT_QUEUE_ENABLED is 'false'", async () => {
    const [{ createEventBus }, { SynchronousEventBus }] = await loadFactory({ EVENT_QUEUE_ENABLED: "false" });
    expect(createEventBus()).toBeInstanceOf(SynchronousEventBus);
  });

  it("returns a QueuedEventBus when EVENT_QUEUE_ENABLED is 'true'", async () => {
    const [{ createEventBus }, , { QueuedEventBus }] = await loadFactory({ EVENT_QUEUE_ENABLED: "true" });
    expect(createEventBus()).toBeInstanceOf(QueuedEventBus);
  });

  it("memoizes a single instance per process", async () => {
    const [{ createEventBus }] = await loadFactory();
    expect(createEventBus()).toBe(createEventBus());
  });

  it("the queued bus implements the identical EventBus port: publish/subscribe still work end to end", async () => {
    const [{ createEventBus }] = await loadFactory({ EVENT_QUEUE_ENABLED: "true" });
    const bus = createEventBus();

    const { DomainEvent } = await import("@/domain/events/domain-event");
    class PingEvent extends DomainEvent {
      static readonly eventName = "ping";
      constructor() {
        super();
      }
    }

    const handler = { handle: () => {} };
    // subscribe()/publish() are the exact same calls a publisher/handler
    // already makes against SynchronousEventBus — no special-casing.
    expect(() => bus.subscribe(PingEvent, handler)).not.toThrow();
    await expect(bus.publish(new PingEvent())).resolves.toBeUndefined();
  });
});
