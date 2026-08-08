import "server-only";

import type { EventBus } from "@/application/ports/event-bus";
import { env } from "@/infrastructure/config/env";
import { EventHandlerRegistry } from "@/infrastructure/events/event-handler-registry";
import type { EventJobData } from "@/infrastructure/events/event-job-serializer";
import {
  createEventJobProcessor,
  eventJobIdempotencyKey,
  EventQueueTransport,
  QueuedEventBus,
} from "@/infrastructure/events/queued-event-bus";
import { createJobIdempotencyStore } from "@/infrastructure/jobs/job-idempotency-store";
import { createJobStore } from "@/infrastructure/jobs/job-store-factory";
import {
  createManagedQueue,
  getBackgroundJobRuntime,
  getJobObserver,
  jobDefaults,
} from "@/infrastructure/jobs/compose";
import type { DeadLetterJobData } from "@/infrastructure/jobs/worker";
import { Worker } from "@/infrastructure/jobs/worker";
import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import { getTracer } from "@/infrastructure/tracing/compose";
import { withEventBusTracing } from "@/infrastructure/tracing/event-bus-tracing";

/**
 * Module 45 — Background Jobs (Roadmap Module 12).
 *
 * Chooses which `EventBus` implementation this process gets — the same
 * factory shape as `cache-service-factory.ts` and
 * `lock-service-factory.ts` (Module 44).
 *
 * **`SynchronousEventBus` remains the default.** Nothing about the
 * platform's event behaviour changes unless `EVENT_QUEUE_ENABLED=true` is
 * set deliberately (see `env.ts` for why this one is opt-in rather than
 * following `REDIS_URL` the way the cache and lock services do).
 *
 * When enabled, this builds the full queued path in one place:
 * registry → queue → transport → bus, plus the worker that drains it and
 * the dead-letter queue exhausted jobs land in. Note that the bus and the
 * worker share **one** `EventHandlerRegistry` instance — the worker
 * resolves a job's `handlerId` against the very registry the publisher
 * subscribed into. That single shared registry is what makes queued
 * dispatch transparent to handlers, and it is the queued analogue of the
 * "there must be exactly one bus instance" rule
 * `infrastructure/events/compose.ts` already documents.
 */
export const EVENT_QUEUE_NAME = "domain-events";
export const EVENT_DEAD_LETTER_QUEUE_NAME = "domain-events-dead-letter";

let instance: EventBus | null = null;

/**
 * Module 51 — Distributed Tracing wraps whichever bus was chosen in
 * `TracedEventBus`, a decorator over the same unmodified `EventBus`
 * port. `withEventBusTracing` returns the bus untouched when tracing is
 * disabled, so the default path is exactly what it was; when enabled,
 * every publish and every individual handler gets a span, with the
 * failure contract (`EventDispatchError`, `handlerName`) preserved
 * verbatim. Applied here — the one place a bus is constructed — for the
 * same reason this factory exists at all: no publisher and no subscriber
 * needs to know.
 */
export function createEventBus(): EventBus {
  if (!instance) {
    const bus = env.EVENT_QUEUE_ENABLED === "true" ? buildQueuedEventBus() : new SynchronousEventBus();
    instance = withEventBusTracing(bus, getTracer());
  }
  return instance;
}

function buildQueuedEventBus(): EventBus {
  const registry = new EventHandlerRegistry();

  const queue = createManagedQueue<EventJobData>(EVENT_QUEUE_NAME);
  const deadLetterQueue = createManagedQueue<DeadLetterJobData>(EVENT_DEAD_LETTER_QUEUE_NAME);

  const worker = new Worker<EventJobData>(EVENT_QUEUE_NAME, createEventJobProcessor(registry), {
    store: createJobStore(),
    concurrency: jobDefaults.concurrency,
    deadLetterQueue,
    observer: getJobObserver(),
    idempotency: {
      store: createJobIdempotencyStore(),
      keyFor: (job) => eventJobIdempotencyKey(job as never),
    },
  });

  getBackgroundJobRuntime().registerWorker(worker);

  const transport = new EventQueueTransport(queue, {
    jobOptions: {
      attempts: jobDefaults.maxAttempts,
      // Exponential from 1s with 20% jitter: a downstream blip (the
      // notification DB briefly unavailable) is absorbed in seconds,
      // while a whole batch of events that failed together does not
      // retry in lockstep. See `backoff.ts`.
      backoff: { type: "exponential", delay: 1000, jitter: 0.2 },
    },
  });

  return new QueuedEventBus(transport, registry);
}

/** Exposed for tests only — forces the next call to re-decide. */
export const __testing = {
  reset(): void {
    instance = null;
  },
};
