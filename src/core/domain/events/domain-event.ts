import { randomUUID } from "node:crypto";

/**
 * Module 34 — Domain Event Bus.
 *
 * The shape `EventBus.subscribe` (see `application/ports/event-bus.ts`)
 * requires from a *class* (not an instance) to accept it as a
 * subscription target: a constructor plus a static `eventName`. Passing
 * the class itself (`subscribe(JobCompleted, handler)`) rather than a
 * bare string is what lets TypeScript infer `T` and reject a handler
 * whose `handle(event: T)` doesn't match at the call site — closing the
 * gap a plain `subscribe("job.completed", handler)` string API would
 * leave open (nothing ties the string to the handler's declared type).
 */
export interface DomainEventClass<T extends DomainEvent = DomainEvent> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- constructor signatures vary per event; only `eventName` below needs to be structurally checked.
  new (...args: any[]): T;
  readonly eventName: string;
}

/**
 * Base class every domain event extends. A domain event is a fact that
 * already happened inside the domain ("a job was completed", "a user
 * verified their email") — it is immutable, named, and carries only the
 * data other parts of the system need to react to it.
 *
 * Deliberately minimal: no framework imports, no infrastructure
 * knowledge. This lives in the domain layer so entities and domain
 * services can construct events without depending on how they're
 * eventually dispatched (`EventBus`, an application-layer port, is the
 * only thing that knows about dispatch — see
 * `application/ports/event-bus.ts`).
 *
 * A concrete event declares exactly one thing beyond its own payload: a
 * static `eventName`, e.g.:
 *
 * ```ts
 * export class JobCompleted extends DomainEvent {
 *   static readonly eventName = "job.completed";
 *   constructor(readonly jobId: string) { super(); }
 * }
 * ```
 *
 * `eventName` lives on the class, not as a separate per-instance literal,
 * so there is exactly one place it can be declared — `subscribe(JobCompleted,
 * handler)` and this class's own `eventName` getter both read the same
 * static property, so they can never drift apart the way two independent
 * string literals could. It's also not `constructor.name`, which
 * minifies/mangles under production builds and would silently break
 * handler routing.
 */
export abstract class DomainEvent {
  readonly occurredAt: Date;
  readonly eventId: string;

  protected constructor(occurredAt: Date = new Date()) {
    this.occurredAt = occurredAt;
    this.eventId = randomUUID();
  }

  /**
   * The stable string discriminator used for dispatch (e.g.
   * `"job.completed"`), read from the concrete subclass's static
   * `eventName`. Throws a clear `TypeError` — rather than silently
   * dispatching to nothing — if a subclass forgets to declare it, since
   * TypeScript can only enforce this at `subscribe()`'s call site, not
   * on the class declaration itself.
   */
  get eventName(): string {
    const eventName = (this.constructor as Partial<DomainEventClass>).eventName;
    if (typeof eventName !== "string") {
      throw new TypeError(
        `${this.constructor.name} must declare a static "eventName" ` +
          `(e.g. \`static readonly eventName = "job.completed";\`) — ` +
          `DomainEvent subclasses are dispatched by this static property, not by their class name.`,
      );
    }
    return eventName;
  }
}
