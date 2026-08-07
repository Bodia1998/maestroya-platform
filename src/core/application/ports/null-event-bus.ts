import type { DomainEvent, DomainEventClass } from "@/domain/events/domain-event";
import type { EventBus, EventHandler } from "@/application/ports/event-bus";

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * A do-nothing `EventBus`, in the same "null object beats an optional
 * callback" tradition as `NullFailureReporter` (Module 39) and
 * `nullJobLifecycleObserver` (Module 45).
 *
 * It exists for exactly one reason. Module 47 needed several long-lived
 * use cases (`CreateProfessionalUseCase`, `UpdateCompanyUseCase`, ...) to
 * start publishing lifecycle events, and those use cases — unlike
 * `CreateReviewUseCase` — had no `EventBus` in their constructors. Adding
 * a *required* parameter would have been a breaking change rippling
 * through every composition root and every existing test that constructs
 * them, for no behavioural benefit. Adding a trailing parameter that
 * defaults to this null bus keeps every existing call site compiling and
 * behaving *identically* to before (publishing into a void is
 * indistinguishable from not publishing), while the real composition
 * roots pass the shared `eventBus` and get real dispatch.
 *
 * It is never registered anywhere and never used in production wiring —
 * `compose.ts` files always inject the real bus.
 */
export class NullEventBus implements EventBus {
  async publish<T extends DomainEvent>(_event: T): Promise<void> {}

  async publishAll(_events: DomainEvent[]): Promise<void> {}

  subscribe<T extends DomainEvent>(_eventType: DomainEventClass<T>, _handler: EventHandler<T>): void {}
}
