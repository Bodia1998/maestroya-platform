import { describe, expect, it } from "vitest";

import { DomainEvent } from "@/domain/events/domain-event";

class SampleOccurredEvent extends DomainEvent {
  static readonly eventName = "sample.occurred";

  constructor(readonly payload: string) {
    super();
  }
}

describe("domain/events/domain-event", () => {
  it("stamps an eventId and occurredAt automatically", () => {
    const before = Date.now();
    const event = new SampleOccurredEvent("hello");
    const after = Date.now();

    expect(event.eventId).toEqual(expect.any(String));
    expect(event.eventId).not.toHaveLength(0);
    expect(event.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(event.occurredAt.getTime()).toBeLessThanOrEqual(after);
  });

  it("gives every event instance a unique eventId", () => {
    const first = new SampleOccurredEvent("a");
    const second = new SampleOccurredEvent("b");

    expect(first.eventId).not.toEqual(second.eventId);
  });

  it("accepts an explicit occurredAt for reconstruction/testing", () => {
    class TimedEvent extends DomainEvent {
      static readonly eventName = "sample.timed";
      constructor(occurredAt: Date) {
        super(occurredAt);
      }
    }
    const explicit = new Date("2026-01-01T00:00:00.000Z");
    const event = new TimedEvent(explicit);

    expect(event.occurredAt).toEqual(explicit);
  });

  it("exposes eventName as a stable discriminator read from the class's static property", () => {
    const event = new SampleOccurredEvent("hello");
    expect(event.eventName).toBe("sample.occurred");
    expect(event.eventName).toBe(SampleOccurredEvent.eventName);
  });

  it("carries subclass-specific payload data", () => {
    const event = new SampleOccurredEvent("hello world");
    expect(event.payload).toBe("hello world");
  });

  it("throws a clear TypeError if a subclass forgets to declare a static eventName", () => {
    class MisconfiguredEvent extends DomainEvent {
      constructor() {
        super();
      }
    }
    const event = new MisconfiguredEvent();

    expect(() => event.eventName).toThrow(/must declare a static "eventName"/);
    expect(() => event.eventName).toThrow(/MisconfiguredEvent/);
  });
});
