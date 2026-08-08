import "server-only";

import type { DomainEvent, DomainEventClass } from "@/domain/events/domain-event";
import type { EventBus, EventHandler } from "@/application/ports/event-bus";
import type { TracingPort } from "@/application/ports/tracing";

/**
 * Module 51 — Distributed Tracing — the domain event bus.
 *
 * `TracedEventBus` is a decorator that implements the *unmodified*
 * `EventBus` port (`application/ports/event-bus.ts`) and delegates
 * everything to the real bus underneath. Neither `SynchronousEventBus`
 * (Module 34) nor `QueuedEventBus` (Module 45) is touched, no publisher
 * changes, and no handler can tell it is there — the same "transport swap
 * underneath the one event bus the platform already has" discipline
 * `QueuedEventBus` itself was built with, applied one layer further out.
 *
 * ## Two spans, at the two places that can actually fail
 *  - **`event.publish <name>`** (`kind: producer`) around `publish()`.
 *    Its duration is "how long publishing cost the caller", which for the
 *    synchronous bus is the full handler fan-out and for the queued bus
 *    is just the enqueue — the difference between the two is visible in
 *    the trace, which is exactly the operational question
 *    `EVENT_QUEUE_ENABLED` raises.
 *  - **`event.handle <name> <Handler>`** (`kind: internal`) around each
 *    individual handler, added by wrapping the handler at `subscribe()`
 *    time. Per-handler spans are what make the fan-out legible: with one
 *    span per event you can see that `dispute.created` took 400ms; with
 *    one per handler you can see that 380ms of it was the notification
 *    subscriber.
 *
 * Wrapping at `subscribe()` — the bus's own registration seam — rather
 * than inside each handler is what keeps this to one file: all 31+
 * existing subscribers across the codebase are instrumented without one
 * of them importing anything.
 *
 * ## Failure semantics are preserved exactly
 * A handler's exception is recorded on its span and re-thrown unchanged,
 * so the underlying bus still collects it into the same
 * `EventDispatchError` with the same `handlerName` — the shape all 37
 * publishing use cases already catch. `handlerName` itself is derived
 * from the *original* handler's constructor before wrapping, so a traced
 * bus never turns a named handler into `"anonymous"` in a failure report.
 */
export class TracedEventBus implements EventBus {
  constructor(
    private readonly delegate: EventBus,
    private readonly tracer: TracingPort,
  ) {}

  async publish<T extends DomainEvent>(event: T): Promise<void> {
    return this.tracer.withSpan(
      `event.publish ${event.eventName}`,
      async (span) => {
        const startedAt = Date.now();
        try {
          await this.delegate.publish(event);
          span.setAttribute("event.duration_ms", Date.now() - startedAt);
          span.setAttribute("event.outcome", "success");
        } catch (error) {
          span.setAttribute("event.duration_ms", Date.now() - startedAt);
          span.setAttribute("event.outcome", "failure");
          throw error;
        }
      },
      {
        kind: "producer",
        attributes: {
          "event.name": event.eventName,
          "event.id": event.eventId,
          "messaging.system": "maestroya.event-bus",
        },
      },
    );
  }

  /**
   * Delegates to `publish` one event at a time — never `Promise.all` —
   * preserving the causal ordering guarantee `SynchronousEventBus`
   * documents. Deliberately does not call `this.delegate.publishAll`:
   * doing so would bypass the per-event spans above and produce one
   * opaque span for a batch whose whole interest is which member of it
   * was slow.
   */
  async publishAll(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  subscribe<T extends DomainEvent>(eventType: DomainEventClass<T>, handler: EventHandler<T>): void {
    this.delegate.subscribe(eventType, this.wrapHandler(eventType.eventName, handler));
  }

  private wrapHandler<T extends DomainEvent>(eventName: string, handler: EventHandler<T>): EventHandler<T> {
    const name = handlerName(handler);
    const tracer = this.tracer;

    // A class instance, not an object literal, so that the underlying
    // bus's own `handler.constructor?.name` lookup (see
    // `SynchronousEventBus`/`EventHandlerRegistry`) still yields a
    // meaningful, *stable* identity rather than `"Object"`/`"anonymous"`.
    // `EventHandlerRegistry` derives its `handlerId` — which queued job
    // payloads are keyed by — from exactly that name, so getting this
    // wrong would change job ids, not just log text.
    class TracedEventHandler implements EventHandler<T> {
      async handle(event: T): Promise<void> {
        const startedAt = Date.now();
        await tracer.withSpan(
          `event.handle ${eventName} ${name}`,
          async (span) => {
            try {
              await handler.handle(event);
              span.setAttributes({ "event.handler.outcome": "success" });
            } catch (error) {
              span.setAttributes({ "event.handler.outcome": "failure" });
              throw error;
            } finally {
              span.setAttribute("event.handler.duration_ms", Date.now() - startedAt);
            }
          },
          {
            kind: "internal",
            attributes: {
              "event.name": eventName,
              "event.id": event.eventId,
              "event.handler": name,
            },
          },
        );
      }
    }

    Object.defineProperty(TracedEventHandler, "name", { value: name });
    return new TracedEventHandler();
  }
}

/** Mirrors `SynchronousEventBus`'s own `handlerName` helper exactly. */
function handlerName(handler: EventHandler<never>): string {
  const name = handler.constructor?.name;
  return name && name !== "Object" ? name : "anonymous";
}

/**
 * Wraps `bus` only when tracing is on. Returning the original instance
 * untouched on the disabled path is what keeps "zero overhead when
 * disabled" literally true for the event bus — not one extra call frame
 * per published event.
 */
export function withEventBusTracing(bus: EventBus, tracer: TracingPort): EventBus {
  return tracer.enabled ? new TracedEventBus(bus, tracer) : bus;
}
