import { describe, expect, it, vi } from "vitest";

import type { EventBus, EventHandler } from "@/application/ports/event-bus";
import { DomainEvent } from "@/domain/events/domain-event";
import { TracedEventBus, withEventBusTracing } from "@/infrastructure/tracing/event-bus-tracing";
import { createFakeTracer } from "../../../../test-utils/fake-tracer";

class TestEvent extends DomainEvent {
  static readonly eventName = "test.event";
  constructor() {
    super();
  }
}

class FakeBus implements EventBus {
  publishCalls: DomainEvent[] = [];
  handlers = new Map<string, EventHandler>();

  async publish<T extends DomainEvent>(event: T): Promise<void> {
    this.publishCalls.push(event);
    const handler = this.handlers.get(event.eventName);
    if (handler) await handler.handle(event);
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    for (const event of events) await this.publish(event);
  }

  subscribe<T extends DomainEvent>(eventType: { eventName: string }, handler: EventHandler<T>): void {
    this.handlers.set(eventType.eventName, handler as EventHandler);
  }
}

class NotifySubscriber implements EventHandler<TestEvent> {
  async handle(): Promise<void> {}
}

describe("infrastructure/tracing/event-bus-tracing", () => {
  describe("withEventBusTracing", () => {
    it("returns the delegate untouched when tracing is disabled", () => {
      const tracer = createFakeTracer({ enabled: false });
      const bus = new FakeBus();
      expect(withEventBusTracing(bus, tracer)).toBe(bus);
    });

    it("wraps the delegate in a TracedEventBus when tracing is enabled", () => {
      const tracer = createFakeTracer();
      const bus = new FakeBus();
      expect(withEventBusTracing(bus, tracer)).toBeInstanceOf(TracedEventBus);
    });
  });

  describe("TracedEventBus", () => {
    it("publish() opens a producer span named 'event.publish <name>' and delegates", async () => {
      const tracer = createFakeTracer();
      const delegate = new FakeBus();
      const traced = new TracedEventBus(delegate, tracer);
      const event = new TestEvent();

      await traced.publish(event);

      expect(delegate.publishCalls).toEqual([event]);
      const publishSpan = tracer.spans.find((s) => s.name === "event.publish test.event");
      expect(publishSpan?.kind).toBe("producer");
      expect(publishSpan?.attributes["event.name"]).toBe("test.event");
      expect(publishSpan?.attributes["event.id"]).toBe(event.eventId);
      expect(publishSpan?.attributes["event.outcome"]).toBe("success");
      expect(publishSpan?.ended).toBe(true);
    });

    it("publish() records failure outcome and re-throws the original error unchanged", async () => {
      const tracer = createFakeTracer();
      const error = new Error("publish failed");
      const delegate: EventBus = {
        publish: vi.fn().mockRejectedValue(error),
        publishAll: vi.fn(),
        subscribe: vi.fn(),
      };
      const traced = new TracedEventBus(delegate, tracer);

      await expect(traced.publish(new TestEvent())).rejects.toBe(error);
      const span = tracer.spans[0]!;
      expect(span.attributes["event.outcome"]).toBe("failure");
    });

    it("publishAll() publishes events one at a time, in order (not Promise.all)", async () => {
      const tracer = createFakeTracer();
      const delegate = new FakeBus();
      const traced = new TracedEventBus(delegate, tracer);
      const events = [new TestEvent(), new TestEvent(), new TestEvent()];

      await traced.publishAll(events);

      expect(delegate.publishCalls).toEqual(events);
      expect(tracer.spans.filter((s) => s.name === "event.publish test.event")).toHaveLength(3);
    });

    it("subscribe() wraps the handler so each invocation gets its own 'event.handle' span", async () => {
      const tracer = createFakeTracer();
      const delegate = new FakeBus();
      const traced = new TracedEventBus(delegate, tracer);
      const handler = new NotifySubscriber();
      const handleSpy = vi.spyOn(handler, "handle");

      traced.subscribe(TestEvent, handler);
      await traced.publish(new TestEvent());

      expect(handleSpy).toHaveBeenCalledTimes(1);
      const handleSpan = tracer.spans.find((s) => s.name === "event.handle test.event NotifySubscriber");
      expect(handleSpan?.kind).toBe("internal");
      expect(handleSpan?.attributes["event.handler"]).toBe("NotifySubscriber");
      expect(handleSpan?.attributes["event.handler.outcome"]).toBe("success");
    });

    it("a handler's exception is recorded on its span and re-thrown so the underlying bus's failure contract is preserved", async () => {
      const tracer = createFakeTracer();
      const delegate = new FakeBus();
      const traced = new TracedEventBus(delegate, tracer);
      const error = new Error("handler exploded");
      const failingHandler: EventHandler<TestEvent> = {
        async handle() {
          throw error;
        },
      };

      traced.subscribe(TestEvent, failingHandler);
      await expect(traced.publish(new TestEvent())).rejects.toBe(error);

      const handleSpan = tracer.spans.find((s) => s.name.startsWith("event.handle test.event"));
      expect(handleSpan?.attributes["event.handler.outcome"]).toBe("failure");
      expect(handleSpan?.exceptions).toContain(error);
    });

    it("preserves anonymous-handler naming for plain object-literal handlers", async () => {
      const tracer = createFakeTracer();
      const delegate = new FakeBus();
      const traced = new TracedEventBus(delegate, tracer);

      traced.subscribe(TestEvent, { async handle() {} });
      await traced.publish(new TestEvent());

      const handleSpan = tracer.spans.find((s) => s.name.startsWith("event.handle test.event"));
      expect(handleSpan?.attributes["event.handler"]).toBe("anonymous");
    });
  });
});
