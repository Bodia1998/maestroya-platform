import { describe, expect, it, vi } from "vitest";

import { DomainEvent } from "@/domain/events/domain-event";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { EventHandlerRegistry } from "@/infrastructure/events/event-handler-registry";
import { serializeEventJob } from "@/infrastructure/events/event-job-serializer";
import type { EventJobData } from "@/infrastructure/events/event-job-serializer";
import {
  createEventJobProcessor,
  eventJobId,
  eventJobIdempotencyKey,
  EventQueueTransport,
  QueuedEventBus,
} from "@/infrastructure/events/queued-event-bus";
import type { EventDispatchTransport } from "@/infrastructure/events/queued-event-bus";
import { InMemoryJobStore } from "@/infrastructure/jobs/in-memory-job-store";
import { Queue } from "@/infrastructure/jobs/queue";
import { toActiveJob } from "@/infrastructure/jobs/job-types";
import type { StoredJob } from "@/infrastructure/jobs/job-types";

class DisputeCreated extends DomainEvent {
  static readonly eventName = "dispute.created";
  constructor(readonly disputeId: string) {
    super();
  }
}

describe("infrastructure/events/queued-event-bus", () => {
  describe("QueuedEventBus", () => {
    it("publish() with no subscribers is a no-op, same as SynchronousEventBus", async () => {
      const transport: EventDispatchTransport = { dispatch: vi.fn() };
      const bus = new QueuedEventBus(transport);
      await expect(bus.publish(new DisputeCreated("d1"))).resolves.toBeUndefined();
      expect(transport.dispatch).not.toHaveBeenCalled();
    });

    it("publish() dispatches once per subscription for the event", async () => {
      const dispatch = vi.fn().mockResolvedValue(undefined);
      const bus = new QueuedEventBus({ dispatch });
      bus.subscribe(DisputeCreated, { handle: vi.fn() });
      bus.subscribe(DisputeCreated, { handle: vi.fn() });

      await bus.publish(new DisputeCreated("d1"));

      expect(dispatch).toHaveBeenCalledTimes(2);
    });

    it("preserves the exact EventBus signature/failure contract: bundles enqueue failures into one EventDispatchError", async () => {
      const failureA = new Error("enqueue failed for handler A");
      const dispatch = vi.fn().mockRejectedValueOnce(failureA).mockResolvedValueOnce(undefined);
      const bus = new QueuedEventBus({ dispatch });
      bus.subscribe(DisputeCreated, { handle: vi.fn() });
      bus.subscribe(DisputeCreated, { handle: vi.fn() });

      const event = new DisputeCreated("d1");
      const rejection: unknown = await bus.publish(event).catch((error) => error);

      expect(rejection).toBeInstanceOf(EventDispatchError);
      const error = rejection as EventDispatchError;
      expect(error.eventName).toBe("dispute.created");
      expect(error.eventId).toBe(event.eventId);
      expect(error.causes).toEqual([failureA]);
      // Every subscription is still attempted even though the first failed.
      expect(dispatch).toHaveBeenCalledTimes(2);
    });

    it("publishAll processes events one at a time, in order", async () => {
      const order: string[] = [];
      const dispatch = vi.fn(async (event: DomainEvent) => {
        order.push(event.eventName);
      });
      const bus = new QueuedEventBus({ dispatch });
      bus.subscribe(DisputeCreated, { handle: vi.fn() });

      await bus.publishAll([new DisputeCreated("d1"), new DisputeCreated("d2")]);

      expect(order).toEqual(["dispute.created", "dispute.created"]);
    });
  });

  describe("EventQueueTransport", () => {
    it("enqueues one job per (event, subscription) with a deterministic id", async () => {
      const add = vi.fn().mockResolvedValue({});
      const transport = new EventQueueTransport({ add });
      const registry = new EventHandlerRegistry();
      const subscription = registry.register(DisputeCreated, { handle: vi.fn() });

      const event = new DisputeCreated("d1");
      await transport.dispatch(event, subscription);

      expect(add).toHaveBeenCalledWith(
        "dispute.created",
        expect.objectContaining({ eventId: event.eventId, handlerId: subscription.handlerId }),
        expect.objectContaining({ jobId: eventJobId(event.eventId, subscription.handlerId) }),
      );
    });

    it("publishing the same event instance twice enqueues one job, not two (real queue, real de-dup)", async () => {
      const store = new InMemoryJobStore();
      const queue = new Queue<EventJobData>("domain-events", { store });
      const transport = new EventQueueTransport(queue);
      const registry = new EventHandlerRegistry();
      const subscription = registry.register(DisputeCreated, { handle: vi.fn() });
      const event = new DisputeCreated("d1");

      await transport.dispatch(event, subscription);
      await transport.dispatch(event, subscription);

      expect((await queue.getCounts()).waiting).toBe(1);
    });

    it("applies the configured jobOptions (attempts/backoff) to every enqueued job", async () => {
      const add = vi.fn().mockResolvedValue({});
      const transport = new EventQueueTransport(
        { add },
        { jobOptions: { attempts: 5, backoff: { type: "fixed", delay: 2000 } } },
      );
      const registry = new EventHandlerRegistry();
      const subscription = registry.register(DisputeCreated, { handle: vi.fn() });

      await transport.dispatch(new DisputeCreated("d1"), subscription);

      expect(add).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ attempts: 5, backoff: { type: "fixed", delay: 2000 } }),
      );
    });
  });

  describe("createEventJobProcessor", () => {
    it("resolves the handler by handlerId, rebuilds the event, and runs the handler", async () => {
      const registry = new EventHandlerRegistry();
      const handle = vi.fn();
      const subscription = registry.register(DisputeCreated, { handle });
      const event = new DisputeCreated("d1");
      const data = serializeEventJob(event, subscription.handlerId);

      const process = createEventJobProcessor(registry);
      await process(toActiveJob(makeStoredJob(data)));

      expect(handle).toHaveBeenCalledTimes(1);
      const received = handle.mock.calls[0]![0] as DisputeCreated;
      expect(received.disputeId).toBe("d1");
      expect(received).toBeInstanceOf(DisputeCreated);
    });

    it("throws (rather than silently skipping) when the handlerId cannot be resolved", async () => {
      const registry = new EventHandlerRegistry();
      const event = new DisputeCreated("d1");
      const data = serializeEventJob(event, "dispute.created#0:GoneHandler");

      const process = createEventJobProcessor(registry);
      await expect(process(toActiveJob(makeStoredJob(data)))).rejects.toThrow(/No subscriber/);
    });

    it("propagates a handler's own throw so the worker can retry it", async () => {
      const registry = new EventHandlerRegistry();
      const subscription = registry.register(DisputeCreated, {
        handle: () => {
          throw new Error("handler exploded");
        },
      });
      const data = serializeEventJob(new DisputeCreated("d1"), subscription.handlerId);

      const process = createEventJobProcessor(registry);
      await expect(process(toActiveJob(makeStoredJob(data)))).rejects.toThrow("handler exploded");
    });
  });

  describe("eventJobIdempotencyKey", () => {
    it("combines eventId and handlerId so two handlers of one event both run, but redelivery to one doesn't double-run", () => {
      const data: EventJobData = {
        eventName: "dispute.created",
        eventId: "evt-1",
        occurredAt: new Date().toISOString(),
        handlerId: "dispute.created#0:NotifyHandler",
        payload: {},
      };
      expect(eventJobIdempotencyKey(toActiveJob(makeStoredJob(data)))).toBe(
        "event:evt-1:dispute.created#0:NotifyHandler",
      );
    });
  });
});

function makeStoredJob(data: EventJobData): StoredJob<EventJobData> {
  return {
    id: eventJobId(data.eventId, data.handlerId),
    queue: "domain-events",
    name: data.eventName,
    data,
    opts: { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
    attemptsMade: 1,
    createdAt: Date.now(),
    processAt: Date.now(),
  };
}
