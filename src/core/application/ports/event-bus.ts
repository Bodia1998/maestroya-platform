import type { DomainEvent, DomainEventClass } from "@/domain/events/domain-event";

/**
 * Module 34 — Domain Event Bus.
 *
 * `EventHandler<T>` reacts to one published event of type `T`. Kept as a
 * one-method interface (rather than a bare function type) so handlers can
 * be classes with injected dependencies (a repository, an email sender,
 * ...), matching the constructor-injection style already used for
 * repositories and services across this codebase (see
 * `application/use-cases/auth/compose.ts`). A class instance also gives
 * `EventDispatchError` (`application/ports/event-dispatch-error.ts`) a
 * meaningful `handlerName` if it throws — a plain `{ handle: fn }` object
 * literal works too, but shows up as `"anonymous"` in failure reports.
 *
 * `handle` may be sync or async — `SynchronousEventBus` awaits it either
 * way, so a handler that just updates an in-memory read model doesn't
 * need to return a Promise for no reason.
 */
export interface EventHandler<T extends DomainEvent = DomainEvent> {
  handle(event: T): void | Promise<void>;
}

/**
 * The single event bus abstraction for the platform. `SynchronousEventBus`
 * (Module 34, `infrastructure/events/synchronous-event-bus.ts`) is the only
 * implementation today; `BullMQEventBus` (Module 45) will implement this
 * same interface to move dispatch onto a queue. Application code —
 * publishers and subscribers alike — depends only on this interface, so
 * swapping the implementation in the composition root
 * (`infrastructure/events/compose.ts`) is the only change Module 45 needs
 * to make; no publisher or handler is touched.
 *
 * Handlers are registered per event via `subscribe`, not passed in a
 * container at construction time — this lets every module register its
 * own handlers independently (in its own `compose.ts`, importing the
 * shared `eventBus` — see that file's doc comment) without a central file
 * enumerating every event/handler pair across all 34+ modules.
 */
export interface EventBus {
  /**
   * Dispatches `event` to every handler subscribed to `event`'s class.
   * Resolves once all handlers have run. See `SynchronousEventBus` for
   * the exact failure-propagation contract when one or more handlers
   * throw (`EventDispatchError`).
   */
  publish<T extends DomainEvent>(event: T): Promise<void>;

  /**
   * Convenience for publishing several events produced by a single use
   * case (e.g. an aggregate that raised multiple domain events) in
   * order, one at a time. Not just `Promise.all(events.map(publish))` —
   * see the implementation's doc comment for why ordering matters here.
   */
  publishAll(events: DomainEvent[]): Promise<void>;

  /**
   * Registers `handler` to run whenever an event of type `eventType` is
   * published, e.g. `subscribe(JobCompleted, someHandler)`. Multiple
   * handlers may subscribe to the same event type; all of them run, in
   * subscription order.
   *
   * Taking the event *class* rather than a bare event-name string is
   * what makes this fully type-safe: `T` is inferred from `eventType`,
   * so `handler` must be an `EventHandler<T>` for that exact class —
   * passing a handler built for a different event is a compile error,
   * not a runtime mismatch discovered only once the wrong-shaped event
   * reaches it.
   */
  subscribe<T extends DomainEvent>(eventType: DomainEventClass<T>, handler: EventHandler<T>): void;
}
