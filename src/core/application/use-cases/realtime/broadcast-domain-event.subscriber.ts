import type { DomainEvent } from "@/domain/events/domain-event";
import type { EventHandler } from "@/application/ports/event-bus";
import type { PublishToChannelUseCase } from "@/application/use-cases/realtime/publish-to-channel.use-case";

/**
 * Module 48 — Real-Time System.
 *
 * A generic `EventHandler` that republishes an already-published domain
 * event onto a realtime channel — this is the "Domain Events should
 * automatically publish realtime updates" requirement, implemented as one
 * reusable adapter rather than a bespoke subscriber class per event type.
 * `infrastructure/realtime/compose.ts` registers one instance of this per
 * event class it wants broadcast, each configured with a `mapToChannel`
 * function that knows how to turn *that* event into a channel + payload.
 *
 * Deliberately does not touch `EventBus`/`EventHandlerRegistry` itself —
 * registration happens the same way every other subscriber in this
 * codebase registers (`eventBus.subscribe(SomeEvent, handler)` from a
 * `compose.ts`), so this never duplicates dispatch logic, only adds one
 * more handler to the existing bus.
 */
export class BroadcastDomainEventSubscriber<T extends DomainEvent> implements EventHandler<T> {
  constructor(
    private readonly publish: PublishToChannelUseCase,
    private readonly mapToChannel: (event: T) => { channel: string; type: string; payload: unknown } | null,
  ) {}

  handle(event: T): void {
    const mapped = this.mapToChannel(event);
    if (!mapped) return;
    // Best-effort, fire-and-forget: a realtime push failing must never
    // affect the domain event's other subscribers or roll back the write
    // that raised it — the same "never throws back into the caller"
    // posture `RealtimeHub.publish` already guarantees per-recipient.
    this.publish.execute(mapped);
  }
}
