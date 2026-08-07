import { describe, expect, it } from "vitest";

import { DomainEvent } from "@/domain/events/domain-event";
import { EventHandlerRegistry } from "@/infrastructure/events/event-handler-registry";
import type { EventHandler } from "@/application/ports/event-bus";

class JobCreated extends DomainEvent {
  static readonly eventName = "job.created";
  constructor(readonly jobId: string) {
    super();
  }
}

class JobCancelled extends DomainEvent {
  static readonly eventName = "job.cancelled";
  constructor(readonly jobId: string) {
    super();
  }
}

class RecordingHandler implements EventHandler<JobCreated> {
  handle(): void {}
}

describe("infrastructure/events/event-handler-registry", () => {
  it("subscriptionsFor an unregistered event name returns an empty array", () => {
    const registry = new EventHandlerRegistry();
    expect(registry.subscriptionsFor("nothing.here")).toEqual([]);
  });

  it("register returns a subscription carrying the event class, handler, and a handlerId", () => {
    const registry = new EventHandlerRegistry();
    const handler = new RecordingHandler();
    const subscription = registry.register(JobCreated, handler);

    expect(subscription.eventName).toBe("job.created");
    expect(subscription.eventClass).toBe(JobCreated);
    expect(subscription.handler).toBe(handler);
    expect(subscription.handlerName).toBe("RecordingHandler");
    expect(subscription.handlerId).toBe("job.created#0:RecordingHandler");
  });

  it("two handlers subscribed to the same event get distinct handlerIds (disambiguated by index)", () => {
    const registry = new EventHandlerRegistry();
    const first = registry.register(JobCreated, new RecordingHandler());
    const second = registry.register(JobCreated, new RecordingHandler());

    expect(first.handlerId).not.toBe(second.handlerId);
    expect(first.handlerId).toBe("job.created#0:RecordingHandler");
    expect(second.handlerId).toBe("job.created#1:RecordingHandler");
  });

  it("subscriptionsFor returns subscriptions in registration order", () => {
    const registry = new EventHandlerRegistry();
    const first = registry.register(JobCreated, { handle: () => {} });
    const second = registry.register(JobCreated, { handle: () => {} });

    expect(registry.subscriptionsFor("job.created")).toEqual([first, second]);
  });

  it("subscriptionsFor returns a defensive copy: mutating it does not affect the registry", () => {
    const registry = new EventHandlerRegistry();
    registry.register(JobCreated, { handle: () => {} });

    const list = registry.subscriptionsFor("job.created");
    list.pop();

    expect(registry.subscriptionsFor("job.created")).toHaveLength(1);
  });

  it("findByHandlerId resolves a previously registered subscription", () => {
    const registry = new EventHandlerRegistry();
    const subscription = registry.register(JobCreated, new RecordingHandler());

    expect(registry.findByHandlerId(subscription.handlerId)).toBe(subscription);
  });

  it("findByHandlerId returns undefined for an unknown id", () => {
    const registry = new EventHandlerRegistry();
    expect(registry.findByHandlerId("nope")).toBeUndefined();
  });

  it("separates subscriptions by event name", () => {
    const registry = new EventHandlerRegistry();
    registry.register(JobCreated, { handle: () => {} });
    registry.register(JobCancelled, { handle: () => {} });

    expect(registry.subscriptionsFor("job.created")).toHaveLength(1);
    expect(registry.subscriptionsFor("job.cancelled")).toHaveLength(1);
  });

  it("labels a plain object-literal handler 'anonymous', matching SynchronousEventBus", () => {
    const registry = new EventHandlerRegistry();
    const subscription = registry.register(JobCreated, { handle: () => {} });
    expect(subscription.handlerName).toBe("anonymous");
  });

  it("size reflects the total number of registered subscriptions", () => {
    const registry = new EventHandlerRegistry();
    expect(registry.size).toBe(0);
    registry.register(JobCreated, { handle: () => {} });
    registry.register(JobCancelled, { handle: () => {} });
    expect(registry.size).toBe(2);
  });
});
