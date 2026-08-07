import type { EventHandler } from "@/application/ports/event-bus";
import type { DomainEvent, DomainEventClass } from "@/domain/events/domain-event";

/**
 * Module 45 — Background Jobs (Roadmap Module 12).
 *
 * One subscription: the handler instance, the event class it was
 * registered against, and a **stable string id** that survives the trip
 * through a queue.
 *
 * The id is the crux of asynchronous dispatch. A handler is a live
 * object with injected dependencies (a repository, a notification
 * creator); it cannot be serialized into a job payload and rebuilt on
 * the other side. So a job carries the handler's *id*, and the worker
 * looks the real instance back up in this registry — which is the same
 * in-process registry the publisher subscribed against, because
 * `QueuedEventBus` owns exactly one.
 *
 * `handlerId` is `<eventName>#<index>:<handlerName>`:
 *  - `eventName` and `handlerName` make it readable in a log line or a
 *    dead-letter payload, which matters when diagnosing a stuck job;
 *  - `index` (position in this event's subscription list) disambiguates
 *    two handlers of the same class subscribed to the same event, which
 *    nothing else in the id would.
 *
 * That makes the id dependent on **registration order**, which is safe
 * here for a specific, checked reason: registration is a module-load
 * side effect of each module's own `compose.ts`, and `instrumentation.ts`
 * imports those compose files in a fixed, explicit list at boot. Every
 * instance of the app therefore builds an identical registry in an
 * identical order. The failure mode if that ever stopped being true — a
 * job whose `handlerId` no longer resolves — is handled explicitly and
 * loudly by `createEventJobProcessor` (it throws, the job retries, then
 * dead-letters with the unresolvable id in its payload) rather than
 * silently running the wrong handler.
 */
export interface EventSubscription {
  handlerId: string;
  handlerName: string;
  eventName: string;
  eventClass: DomainEventClass;
  handler: EventHandler<DomainEvent>;
}

export class EventHandlerRegistry {
  private readonly byEventName = new Map<string, EventSubscription[]>();
  private readonly byHandlerId = new Map<string, EventSubscription>();

  register<T extends DomainEvent>(eventClass: DomainEventClass<T>, handler: EventHandler<T>): EventSubscription {
    const eventName = eventClass.eventName;
    const existing = this.byEventName.get(eventName) ?? [];

    const subscription: EventSubscription = {
      handlerId: `${eventName}#${existing.length}:${handlerNameOf(handler)}`,
      handlerName: handlerNameOf(handler),
      eventName,
      eventClass: eventClass as DomainEventClass,
      handler: handler as EventHandler<DomainEvent>,
    };

    existing.push(subscription);
    this.byEventName.set(eventName, existing);
    this.byHandlerId.set(subscription.handlerId, subscription);

    return subscription;
  }

  /**
   * Subscriptions for `eventName`, in registration order. Returns a copy:
   * a handler that subscribes during dispatch must not mutate the list
   * the in-flight dispatch is iterating — the same guarantee
   * `SynchronousEventBus` provides and its test suite asserts ("late
   * `subscribe` doesn't disturb in-flight dispatch").
   */
  subscriptionsFor(eventName: string): EventSubscription[] {
    return [...(this.byEventName.get(eventName) ?? [])];
  }

  findByHandlerId(handlerId: string): EventSubscription | undefined {
    return this.byHandlerId.get(handlerId);
  }

  get size(): number {
    return this.byHandlerId.size;
  }
}

/**
 * Best-effort handler name, matching `SynchronousEventBus`'s own
 * `handlerName()` exactly — a class instance gives its constructor name,
 * a plain `{ handle: fn }` object literal gives `"anonymous"`. Kept
 * identical so `EventDispatchError.failures[].handlerName` reads the
 * same whether dispatch was synchronous or queued.
 */
function handlerNameOf(handler: EventHandler<never>): string {
  const name = handler.constructor?.name;
  return name && name !== "Object" ? name : "anonymous";
}
