import { describe, expect, it, vi } from "vitest";

import { DomainEvent } from "@/domain/events/domain-event";
import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
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
  readonly seen: JobCreated[] = [];
  handle(event: JobCreated): void {
    this.seen.push(event);
  }
}

class ThrowingHandler implements EventHandler<JobCreated> {
  constructor(private readonly error: unknown) {}
  handle(): void {
    throw this.error;
  }
}

describe("infrastructure/events/synchronous-event-bus", () => {
  it("publishing an event with no subscribers is a no-op, not an error", async () => {
    const bus = new SynchronousEventBus();
    await expect(bus.publish(new JobCreated("job_1"))).resolves.toBeUndefined();
  });

  it("dispatches to a single subscribed handler with the exact event instance", async () => {
    const bus = new SynchronousEventBus();
    const handler = new RecordingHandler();
    bus.subscribe(JobCreated, handler);

    const event = new JobCreated("job_1");
    await bus.publish(event);

    expect(handler.seen).toEqual([event]);
  });

  it("only invokes handlers subscribed to the matching event class", async () => {
    const bus = new SynchronousEventBus();
    const createdHandler = vi.fn();
    const cancelledHandler = vi.fn();
    bus.subscribe(JobCreated, { handle: createdHandler });
    bus.subscribe(JobCancelled, { handle: cancelledHandler });

    await bus.publish(new JobCreated("job_1"));

    expect(createdHandler).toHaveBeenCalledTimes(1);
    expect(cancelledHandler).not.toHaveBeenCalled();
  });

  it("runs multiple handlers subscribed to the same event, all of them", async () => {
    const bus = new SynchronousEventBus();
    const first = vi.fn();
    const second = vi.fn();
    const third = vi.fn();
    bus.subscribe(JobCreated, { handle: first });
    bus.subscribe(JobCreated, { handle: second });
    bus.subscribe(JobCreated, { handle: third });

    await bus.publish(new JobCreated("job_1"));

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(third).toHaveBeenCalledTimes(1);
  });

  it("runs handlers for the same event in deterministic subscription order", async () => {
    const bus = new SynchronousEventBus();
    const order: string[] = [];
    bus.subscribe(JobCreated, { handle: () => void order.push("first") });
    bus.subscribe(JobCreated, { handle: () => void order.push("second") });
    bus.subscribe(JobCreated, { handle: () => void order.push("third") });

    await bus.publish(new JobCreated("job_1"));

    expect(order).toEqual(["first", "second", "third"]);
  });

  it("awaits async handlers before resolving publish", async () => {
    const bus = new SynchronousEventBus();
    let resolved = false;
    bus.subscribe(JobCreated, {
      handle: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        resolved = true;
      },
    });

    await bus.publish(new JobCreated("job_1"));

    expect(resolved).toBe(true);
  });

  it("a throwing handler does not prevent sibling handlers from running", async () => {
    const bus = new SynchronousEventBus();
    const ranAfterFailure = vi.fn();
    bus.subscribe(JobCreated, new ThrowingHandler(new Error("boom")));
    bus.subscribe(JobCreated, { handle: ranAfterFailure });

    await expect(bus.publish(new JobCreated("job_1"))).rejects.toThrow(EventDispatchError);
    expect(ranAfterFailure).toHaveBeenCalledTimes(1);
  });

  it("wraps a single handler failure in an EventDispatchError carrying event and handler context", async () => {
    const bus = new SynchronousEventBus();
    const failure = new Error("handler exploded");
    bus.subscribe(JobCreated, new ThrowingHandler(failure));

    const event = new JobCreated("job_1");
    const rejection: unknown = await bus.publish(event).catch((error) => error);

    expect(rejection).toBeInstanceOf(EventDispatchError);
    const error = rejection as EventDispatchError;
    expect(error.eventName).toBe("job.created");
    expect(error.eventId).toBe(event.eventId);
    expect(error.failures).toEqual([{ handlerName: "ThrowingHandler", error: failure }]);
    expect(error.causes).toEqual([failure]);
  });

  it("bundles multiple handler failures into one EventDispatchError so none are lost", async () => {
    const bus = new SynchronousEventBus();
    const errorA = new Error("handler A failed");
    const errorB = new Error("handler B failed");
    bus.subscribe(JobCreated, new ThrowingHandler(errorA));
    bus.subscribe(JobCreated, new ThrowingHandler(errorB));
    bus.subscribe(JobCreated, { handle: vi.fn() });

    const rejection: unknown = await bus.publish(new JobCreated("job_1")).catch((error) => error);

    expect(rejection).toBeInstanceOf(EventDispatchError);
    const error = rejection as EventDispatchError;
    expect(error.causes).toEqual([errorA, errorB]);
    expect(error.failures.map((f) => f.handlerName)).toEqual(["ThrowingHandler", "ThrowingHandler"]);
  });

  it("labels a plain object-literal handler as 'anonymous' in failure reports", async () => {
    const bus = new SynchronousEventBus();
    bus.subscribe(JobCreated, {
      handle: () => {
        throw new Error("boom");
      },
    });

    const rejection: unknown = await bus.publish(new JobCreated("job_1")).catch((error) => error);

    expect((rejection as EventDispatchError).failures).toEqual([
      { handlerName: "anonymous", error: expect.any(Error) },
    ]);
  });

  it("publishAll dispatches every event, in order", async () => {
    const bus = new SynchronousEventBus();
    const order: string[] = [];
    bus.subscribe(JobCreated, { handle: () => void order.push("created") });
    bus.subscribe(JobCancelled, { handle: () => void order.push("cancelled") });

    await bus.publishAll([new JobCreated("job_1"), new JobCancelled("job_1")]);

    expect(order).toEqual(["created", "cancelled"]);
  });

  it("publishAll surfaces a failure from an earlier event without silently skipping it", async () => {
    const bus = new SynchronousEventBus();
    const laterHandler = vi.fn();
    bus.subscribe(JobCreated, new ThrowingHandler(new Error("first event handler failed")));
    bus.subscribe(JobCancelled, { handle: laterHandler });

    await expect(
      bus.publishAll([new JobCreated("job_1"), new JobCancelled("job_1")]),
    ).rejects.toThrow(EventDispatchError);

    // publishAll stops at the first failing event rather than masking it —
    // the second event's handler must not have run.
    expect(laterHandler).not.toHaveBeenCalled();
  });

  it("registering a new handler does not affect already-in-flight subscriptions for other events", async () => {
    const bus = new SynchronousEventBus();
    const cancelledHandler = vi.fn();
    bus.subscribe(JobCreated, { handle: vi.fn() });
    bus.subscribe(JobCancelled, { handle: cancelledHandler });

    await bus.publish(new JobCancelled("job_1"));

    expect(cancelledHandler).toHaveBeenCalledTimes(1);
  });
});
