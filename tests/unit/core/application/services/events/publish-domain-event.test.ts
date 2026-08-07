import { describe, expect, it, vi } from "vitest";

import { CompanyCreated } from "@/domain/events/company-created";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import type { FailureReporter } from "@/application/ports/failure-reporter";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";

describe("application/services/events/publish-domain-event", () => {
  it("publishes the event through the given bus", async () => {
    const bus: EventBus = {
      publish: vi.fn().mockResolvedValue(undefined),
      publishAll: vi.fn(),
      subscribe: vi.fn(),
    };
    const event = new CompanyCreated("company-1", "owner-1");

    await publishDomainEvent(bus, event);

    expect(bus.publish).toHaveBeenCalledWith(event);
  });

  it("swallows an EventDispatchError and reports it, rather than rethrowing", async () => {
    const dispatchError = new EventDispatchError("company.created", "evt-1", []);
    const bus: EventBus = {
      publish: vi.fn().mockRejectedValue(dispatchError),
      publishAll: vi.fn(),
      subscribe: vi.fn(),
    };
    const failureReporter: FailureReporter = { report: vi.fn() };

    await expect(publishDomainEvent(bus, new CompanyCreated("company-1", "owner-1"), failureReporter)).resolves.toBeUndefined();

    expect(failureReporter.report).toHaveBeenCalledWith(
      dispatchError,
      expect.objectContaining({ event: "company.created", eventId: "evt-1" }),
    );
  });

  it("does not swallow a non-EventDispatchError — a genuine bug in the bus still propagates", async () => {
    const bug = new Error("bus itself is broken");
    const bus: EventBus = {
      publish: vi.fn().mockRejectedValue(bug),
      publishAll: vi.fn(),
      subscribe: vi.fn(),
    };

    await expect(publishDomainEvent(bus, new CompanyCreated("company-1", "owner-1"))).rejects.toBe(bug);
  });
});
