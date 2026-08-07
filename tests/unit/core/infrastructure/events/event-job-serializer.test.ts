import { describe, expect, it } from "vitest";

import { DomainEvent } from "@/domain/events/domain-event";
import { deserializeEventJob, serializeEventJob } from "@/infrastructure/events/event-job-serializer";

class DisputeCreated extends DomainEvent {
  static readonly eventName = "dispute.created";
  constructor(
    readonly disputeId: string,
    readonly amount: number,
    readonly openedAt: Date,
    readonly tags: string[],
    readonly meta: { severity: string; internal: boolean } | null,
  ) {
    super();
  }
}

class BadEvent extends DomainEvent {
  static readonly eventName = "bad.event";
  constructor(readonly handler: () => void) {
    super();
  }
}

describe("infrastructure/events/event-job-serializer", () => {
  it("round-trips a domain event's own fields through serialize/deserialize", () => {
    const openedAt = new Date("2026-08-01T12:00:00.000Z");
    const event = new DisputeCreated("d1", 199.5, openedAt, ["urgent", "escalated"], {
      severity: "high",
      internal: false,
    });

    const data = serializeEventJob(event, "dispute.created#0:SomeHandler");
    const revived = deserializeEventJob(data, DisputeCreated) as DisputeCreated;

    expect(revived.disputeId).toBe("d1");
    expect(revived.amount).toBe(199.5);
    expect(revived.openedAt).toEqual(openedAt);
    expect(revived.openedAt).toBeInstanceOf(Date);
    expect(revived.tags).toEqual(["urgent", "escalated"]);
    expect(revived.meta).toEqual({ severity: "high", internal: false });
  });

  it("preserves eventId and occurredAt exactly, not minting new ones", () => {
    const event = new DisputeCreated("d1", 1, new Date(), [], null);
    const data = serializeEventJob(event, "h");
    const revived = deserializeEventJob(data, DisputeCreated);

    expect(revived.eventId).toBe(event.eventId);
    expect(revived.occurredAt.toISOString()).toBe(event.occurredAt.toISOString());
  });

  it("the revived event is a genuine instance: instanceof and eventName both work", () => {
    const event = new DisputeCreated("d1", 1, new Date(), [], null);
    const data = serializeEventJob(event, "h");
    const revived = deserializeEventJob(data, DisputeCreated);

    expect(revived).toBeInstanceOf(DisputeCreated);
    expect(revived).toBeInstanceOf(DomainEvent);
    expect(revived.eventName).toBe("dispute.created");
  });

  it("carries the handlerId and eventName in the wire payload", () => {
    const event = new DisputeCreated("d1", 1, new Date(), [], null);
    const data = serializeEventJob(event, "dispute.created#2:NotifyHandler");

    expect(data.eventName).toBe("dispute.created");
    expect(data.eventId).toBe(event.eventId);
    expect(data.handlerId).toBe("dispute.created#2:NotifyHandler");
  });

  it("does not duplicate eventId/occurredAt into the payload body", () => {
    const event = new DisputeCreated("d1", 1, new Date(), [], null);
    const data = serializeEventJob(event, "h");

    expect(data.payload).not.toHaveProperty("eventId");
    expect(data.payload).not.toHaveProperty("occurredAt");
    expect(data.payload.disputeId).toBe("d1");
  });

  it("survives an actual JSON.stringify/parse round trip (the real transport path)", () => {
    const event = new DisputeCreated("d1", 42, new Date("2026-01-01T00:00:00.000Z"), ["a"], { severity: "low", internal: true });
    const wire = JSON.parse(JSON.stringify(serializeEventJob(event, "h")));
    const revived = deserializeEventJob(wire, DisputeCreated) as DisputeCreated;

    expect(revived.disputeId).toBe("d1");
    expect(revived.openedAt).toBeInstanceOf(Date);
    expect(revived.openedAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("encodes null and undefined fields as null", () => {
    const event = new DisputeCreated("d1", 1, new Date(), [], null);
    const data = serializeEventJob(event, "h");
    expect(data.payload.meta).toBeNull();
  });

  it("throws loudly rather than silently dropping a field it cannot serialize", () => {
    const event = new BadEvent(() => {});
    expect(() => serializeEventJob(event, "h")).toThrow(TypeError);
  });
});
