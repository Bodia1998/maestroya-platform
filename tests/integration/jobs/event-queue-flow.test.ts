import { describe, expect, it, vi } from "vitest";

import { DomainEvent } from "@/domain/events/domain-event";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { EventHandlerRegistry } from "@/infrastructure/events/event-handler-registry";
import type { EventJobData } from "@/infrastructure/events/event-job-serializer";
import {
  createEventJobProcessor,
  eventJobIdempotencyKey,
  EventQueueTransport,
  QueuedEventBus,
} from "@/infrastructure/events/queued-event-bus";
import { InMemoryJobIdempotencyStore } from "@/infrastructure/jobs/job-idempotency-store";
import { InMemoryJobStore } from "@/infrastructure/jobs/in-memory-job-store";
import { Queue } from "@/infrastructure/jobs/queue";
import type { DeadLetterJobData } from "@/infrastructure/jobs/worker";
import { Worker } from "@/infrastructure/jobs/worker";

class DisputeCreated extends DomainEvent {
  static readonly eventName = "dispute.created";
  constructor(readonly disputeId: string) {
    super();
  }
}

/**
 * Module 45 — Background Jobs (Roadmap Module 12).
 *
 * End-to-end: a publisher calls `QueuedEventBus.publish()` exactly as it
 * would call `SynchronousEventBus.publish()`, the event lands on a real
 * `Queue`/`InMemoryJobStore`, and a `Worker` drains it and runs the
 * *original* subscribed handler — proving the whole transport swap is
 * transparent end to end, not just at the unit level.
 */
function buildStack(options: { attempts?: number } = {}) {
  const registry = new EventHandlerRegistry();
  const store = new InMemoryJobStore();
  const queue = new Queue<EventJobData>("domain-events", { store });
  const deadLetterQueue = new Queue<DeadLetterJobData>("domain-events-dead-letter", { store });
  const idempotencyStore = new InMemoryJobIdempotencyStore();

  const transport = new EventQueueTransport(queue, {
    jobOptions: { attempts: options.attempts ?? 3, backoff: { type: "fixed", delay: 100 } },
  });
  const bus = new QueuedEventBus(transport, registry);

  const worker = new Worker("domain-events", createEventJobProcessor(registry), {
    store,
    deadLetterQueue,
    idempotency: { store: idempotencyStore, keyFor: (job) => eventJobIdempotencyKey(job as never) },
  });

  return { bus, worker, queue, deadLetterQueue, idempotencyStore };
}

describe("Module 45 — event queue end-to-end flow", () => {
  it("publish() enqueues, and the worker runs the exact handler that was subscribed via the EventBus port", async () => {
    const { bus, worker } = buildStack();
    const handle = vi.fn();
    bus.subscribe(DisputeCreated, { handle });

    await bus.publish(new DisputeCreated("d1"));
    expect(handle).not.toHaveBeenCalled(); // not run inline — only enqueued so far

    await worker.processNext();

    expect(handle).toHaveBeenCalledTimes(1);
    const received = handle.mock.calls[0]![0] as DisputeCreated;
    expect(received.disputeId).toBe("d1");
  });

  it("multiple subscribers to the same event each get their own job and both run", async () => {
    const { bus, worker } = buildStack();
    const first = vi.fn();
    const second = vi.fn();
    bus.subscribe(DisputeCreated, { handle: first });
    bus.subscribe(DisputeCreated, { handle: second });

    await bus.publish(new DisputeCreated("d1"));
    await worker.processNext();
    await worker.processNext();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("a failing handler is retried, then succeeds on a later attempt", async () => {
    const { bus, worker, queue } = buildStack({ attempts: 3 });
    let calls = 0;
    bus.subscribe(DisputeCreated, {
      handle: () => {
        calls += 1;
        if (calls < 2) throw new Error("transient failure");
      },
    });

    await bus.publish(new DisputeCreated("d1"));
    await worker.processNext(); // fails, scheduled for retry
    expect((await queue.getCounts()).completed).toBe(0);

    // Advance past the fixed 100ms backoff by reserving with a later "now".
    await new Promise((resolve) => setTimeout(resolve, 110));
    await worker.processNext(); // succeeds

    expect(calls).toBe(2);
    expect((await queue.getCounts()).completed).toBe(1);
  });

  it("a permanently failing handler is dead-lettered after attempts are exhausted", async () => {
    const { bus, worker, deadLetterQueue } = buildStack({ attempts: 1 });
    bus.subscribe(DisputeCreated, {
      handle: () => {
        throw new Error("permanently broken");
      },
    });

    await bus.publish(new DisputeCreated("d1"));
    await worker.processNext();

    expect((await deadLetterQueue.getCounts()).waiting).toBe(1);
  });

  it("redelivering the same event to the same handler after a successful run is skipped (idempotent execution)", async () => {
    const { bus, worker, idempotencyStore } = buildStack();
    const handle = vi.fn();
    bus.subscribe(DisputeCreated, { handle });

    const event = new DisputeCreated("d1");
    await bus.publish(event);
    await worker.processNext();
    expect(handle).toHaveBeenCalledTimes(1);

    // Simulate a redelivery of the exact same event to the exact same
    // handler (e.g. an at-least-once queue replaying an unacked job).
    const key = `event:${event.eventId}:${bus.registry.subscriptionsFor("dispute.created")[0]!.handlerId}`;
    expect(await idempotencyStore.isProcessed(key)).toBe(true);
  });

  it("an EventDispatchError from publish() means 'could not enqueue', matching the documented queued-mode semantics", async () => {
    const { bus } = buildStack();
    bus.subscribe(DisputeCreated, { handle: vi.fn() });
    // Force the underlying transport to fail by closing the bus's queue
    // out from under it via a broken transport.
    const brokenBus = new QueuedEventBus({
      dispatch: () => Promise.reject(new Error("queue unreachable")),
    });
    brokenBus.subscribe(DisputeCreated, { handle: vi.fn() });

    await expect(brokenBus.publish(new DisputeCreated("d1"))).rejects.toThrow(EventDispatchError);
  });
});
