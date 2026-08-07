import type { EventBus, EventHandler } from "@/application/ports/event-bus";
import { EventDispatchError, type FailedEventHandler } from "@/application/ports/event-dispatch-error";
import type { DomainEvent, DomainEventClass } from "@/domain/events/domain-event";
import { EventHandlerRegistry, type EventSubscription } from "@/infrastructure/events/event-handler-registry";
import { deserializeEventJob, serializeEventJob, type EventJobData } from "@/infrastructure/events/event-job-serializer";
import type { ActiveJob } from "@/infrastructure/jobs/job-types";
import type { JobOptions } from "@/infrastructure/jobs/job-types";

/**
 * The one seam this module adds to event dispatch. An
 * `EventDispatchTransport` decides *where* a handler runs — inline, or on
 * a queue. It is infrastructure-internal and appears nowhere in the
 * application layer: `EventBus` (`application/ports/event-bus.ts`) is
 * unchanged and remains the only abstraction application code sees.
 */
export interface EventDispatchTransport {
  dispatch(event: DomainEvent, subscription: EventSubscription): Promise<void>;
}

/**
 * Module 45 — Background Jobs (Roadmap Module 12).
 *
 * `EventBus` backed by a queue. **BullMQ does not become a second event
 * system** — this class is a transport swap underneath the one event bus
 * the platform already has, and that constraint drove every decision
 * here:
 *
 *  - It implements the existing `EventBus` port, unmodified. `publish`,
 *    `publishAll`, and `subscribe` have byte-identical signatures to
 *    `SynchronousEventBus`'s.
 *  - It preserves the existing failure contract exactly: every
 *    subscription is attempted even if an earlier one failed, and any
 *    failures are bundled into one `EventDispatchError` carrying the same
 *    `eventName`/`eventId`/`handlerName` fields. Publishers already
 *    catch that exact type (`catch (e) { if (!(e instanceof
 *    EventDispatchError)) throw e; failureReporter.report(...) }` — the
 *    shape used by all 37 publishing use cases), so **not one publisher
 *    changes**.
 *  - It preserves ordering: `publishAll` processes events one at a time,
 *    for the causal-ordering reason `SynchronousEventBus` documents.
 *  - Handlers are untouched. They receive a real event instance (see
 *    `event-job-serializer.ts`) and cannot observe which transport ran
 *    them.
 *
 * ## What "failure" means now, and what it deliberately does not
 * With a queue, `publish()` resolves once every handler has been
 * *durably enqueued* — not once every handler has run. So an
 * `EventDispatchError` from a queued bus means "could not enqueue",
 * where from the synchronous bus it meant "the handler threw". That is
 * the real, unavoidable semantic difference between the two modes, and
 * it is safe for this codebase specifically because of what the audit
 * found: no publisher inspects the failures, none is inside a database
 * transaction (every publish is post-commit, the last statement before
 * return), and none needs a handler's result to build its response.
 * Handler failures after enqueue are surfaced through the job layer
 * instead — retried with backoff, then dead-lettered and reported to
 * Sentry (see `job-observability.ts`), which is strictly more visibility
 * than the synchronous bus offered, not less.
 *
 * ## Why this is opt-in
 * `SynchronousEventBus` remains the default and is untouched. Queued
 * dispatch turns on only when `EVENT_QUEUE_ENABLED=true` (see
 * `event-bus-factory.ts`), because the audit also found that **none of
 * the 31 existing subscribers is idempotent** — every one performs an
 * unconditional audit-log or notification insert. At-least-once delivery
 * would duplicate them. The job layer's execution-time de-duplication
 * (`job-idempotency-store.ts`, keyed per event *and* handler) closes
 * that gap, but a default-off rollout is the honest posture for a change
 * that alters delivery semantics for compliance-relevant audit records.
 */
export class QueuedEventBus implements EventBus {
  constructor(
    private readonly transport: EventDispatchTransport,
    readonly registry: EventHandlerRegistry = new EventHandlerRegistry(),
  ) {}

  async publish<T extends DomainEvent>(event: T): Promise<void> {
    const subscriptions = this.registry.subscriptionsFor(event.eventName);

    // Same contract as SynchronousEventBus: publishing an event nobody
    // listens to is normal, not an error.
    if (subscriptions.length === 0) return;

    const failures: FailedEventHandler[] = [];

    for (const subscription of subscriptions) {
      try {
        await this.transport.dispatch(event, subscription);
      } catch (error) {
        failures.push({ handlerName: subscription.handlerName, error });
      }
    }

    if (failures.length > 0) {
      throw new EventDispatchError(event.eventName, event.eventId, failures);
    }
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  subscribe<T extends DomainEvent>(eventType: DomainEventClass<T>, handler: EventHandler<T>): void {
    this.registry.register(eventType, handler);
  }
}

/** What `Queue.add` is called with for one event/handler pair. */
export interface EventQueueTransportOptions {
  /** BullMQ retry options applied to every event job. */
  jobOptions?: Omit<JobOptions, "jobId">;
}

/**
 * The transport that puts one job on the queue per (event, subscription)
 * pair, rather than one job per event.
 *
 * Per-handler jobs are what make retry meaningful: if the notification
 * subscriber for `dispute.created` fails but the audit-log subscriber
 * succeeded, only the notification is retried. A single job per event
 * would re-run every handler on every retry — duplicating the ones that
 * already worked, which for unconditional audit-log inserts is exactly
 * the outcome to avoid. It is also the granularity
 * `event-dispatch-error.ts` already anticipated in its own doc comment
 * ("so a future BullMQ-backed EventBus can report or retry per-handler
 * rather than only at the whole-event level").
 *
 * The job id is deterministic — `${eventId}:${handlerId}` — so publishing
 * the same event instance twice (a retried request, a duplicated call)
 * enqueues one job, not two.
 */
export class EventQueueTransport implements EventDispatchTransport {
  constructor(
    private readonly queue: { add(name: string, data: EventJobData, options?: JobOptions): Promise<unknown> },
    private readonly options: EventQueueTransportOptions = {},
  ) {}

  async dispatch(event: DomainEvent, subscription: EventSubscription): Promise<void> {
    const data = serializeEventJob(event, subscription.handlerId);
    await this.queue.add(event.eventName, data, {
      ...this.options.jobOptions,
      jobId: eventJobId(event.eventId, subscription.handlerId),
    });
  }
}

export function eventJobId(eventId: string, handlerId: string): string {
  return `${eventId}:${handlerId}`;
}

/**
 * The worker-side counterpart: resolves the handler the job names,
 * rebuilds the event, and runs it. Any throw here is a failed attempt —
 * the `Worker` retries it with backoff and eventually dead-letters it.
 *
 * An unresolvable `handlerId` throws rather than being skipped. Skipping
 * would silently discard an audit-log write; throwing surfaces it as a
 * dead-lettered job with the offending id in the payload, which is a
 * problem an operator can actually see and act on.
 */
export function createEventJobProcessor(registry: EventHandlerRegistry) {
  return async (job: ActiveJob<EventJobData>): Promise<void> => {
    const { handlerId, eventName } = job.data;

    const subscription = registry.findByHandlerId(handlerId);
    if (!subscription) {
      throw new Error(
        `No subscriber is registered for handlerId ${JSON.stringify(handlerId)} (event ${JSON.stringify(eventName)}). ` +
          `The job was enqueued by a process whose subscriber registration differs from this one's — ` +
          `see event-handler-registry.ts on registration order.`,
      );
    }

    const event = deserializeEventJob(job.data, subscription.eventClass);
    await subscription.handler.handle(event);
  };
}

/**
 * Idempotency key for an event job: the event's identity plus the
 * specific handler. Two handlers of the same event must both run, so the
 * handler id has to be part of the key; a redelivery of the same event to
 * the same handler must not, so the event id has to be too.
 */
export function eventJobIdempotencyKey(job: ActiveJob<EventJobData>): string {
  return `event:${job.data.eventId}:${job.data.handlerId}`;
}
