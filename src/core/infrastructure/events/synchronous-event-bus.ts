import type { DomainEvent, DomainEventClass } from "@/domain/events/domain-event";
import type { EventBus, EventHandler } from "@/application/ports/event-bus";
import { EventDispatchError, type FailedEventHandler } from "@/application/ports/event-dispatch-error";

/**
 * Module 34 — Domain Event Bus.
 *
 * The initial `EventBus` implementation: handlers run synchronously and
 * in-process, in the same call stack as `publish()`. No queue, no
 * broker, no retry, no persistence of undelivered events — publishing an
 * event *is* running its handlers. This is intentional for the current
 * scale of the platform (see module brief); `BullMQEventBus` (Module 45)
 * is the planned upgrade path for durable, out-of-process dispatch, and
 * will implement this exact same `EventBus` interface so publishers
 * never change.
 *
 * ## Handler failure contract
 * A throwing handler must never prevent sibling handlers for the same
 * event from running, and must never be swallowed silently — both are
 * explicit module requirements. This is also the right default
 * independent of that requirement: handlers for one event are typically
 * unrelated side effects (send an email, update a read model, write an
 * audit log), and one of them being broken today shouldn't degrade the
 * others too. So:
 *
 *  - every subscribed handler for an event runs, in subscription order,
 *    even if an earlier one threw;
 *  - if one or more handlers threw, `publish()` rejects with a single
 *    `EventDispatchError` carrying every failure (see
 *    `application/ports/event-dispatch-error.ts`) — one consistent,
 *    inspectable shape regardless of whether one handler failed or five
 *    did, which is what makes reporting this to Sentry (or, in Module
 *    45, deciding what to retry) straightforward.
 *
 * This mirrors the "collect every failure, never let one silently mask
 * another, still surface *something* catchable" convention already used
 * by `NotificationDispatcher` (Module 32) for fan-out across channels.
 *
 * ## Ordering
 * `publishAll` awaits each event's handlers to completion before moving
 * to the next event, rather than firing all events concurrently. Domain
 * events raised by a single use case are very often causally ordered
 * (e.g. `JobCreated` before `JobAssigned`), and a handler for the second
 * event may reasonably assume the first has already been fully
 * processed — a guarantee `Promise.all` would silently break.
 */
export class SynchronousEventBus implements EventBus {
  private readonly handlers = new Map<string, EventHandler<DomainEvent>[]>();

  async publish<T extends DomainEvent>(event: T): Promise<void> {
    const subscribed = this.handlers.get(event.eventName) ?? [];

    // No subscriber for this event name is not an error — publishing an
    // event nobody currently listens to is normal (e.g. a module
    // publishing ahead of the module that will one day consume it).
    if (subscribed.length === 0) return;

    const failures: FailedEventHandler[] = [];

    for (const handler of subscribed) {
      try {
        await handler.handle(event);
      } catch (error) {
        failures.push({ handlerName: handlerName(handler), error });
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
    const existing = this.handlers.get(eventType.eventName) ?? [];
    existing.push(handler as EventHandler<DomainEvent>);
    this.handlers.set(eventType.eventName, existing);
  }
}

function handlerName(handler: EventHandler<never>): string {
  const name = handler.constructor?.name;
  return name && name !== "Object" ? name : "anonymous";
}
