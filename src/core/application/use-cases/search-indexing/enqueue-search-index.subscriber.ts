import type { DomainEvent } from "@/domain/events/domain-event";
import type { EventHandler } from "@/application/ports/event-bus";
import type { SearchIndexQueue, SearchIndexRequest } from "@/application/ports/search-index-queue";
import { nullSearchObserver, type SearchObserver } from "@/application/ports/search-observer";

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * The bridge from domain events to the indexing pipeline — and
 * deliberately the least capable class in this module. It can do exactly
 * two things: translate an event into a `SearchIndexRequest`, and enqueue
 * it. It holds no `SearchIndexProvider`, so it *cannot* index, even by
 * mistake.
 *
 * That constraint is the module's central rule made structural rather
 * than aspirational. The platform's default `SynchronousEventBus`
 * dispatches subscribers inline inside `publish()`, which itself runs
 * inside the use case that just wrote to Postgres — inside the user's
 * HTTP request. A subscriber that indexed directly would therefore put a
 * network call to Meilisearch on the critical path of creating a
 * professional, and would fail (or slow) that request whenever the engine
 * was slow or down. Enqueuing instead keeps the request path local and
 * fast, and moves the real work to a background worker where retries,
 * backoff, and dead-lettering already exist (Module 45).
 *
 * ## One class, many events
 * Rather than a handler class per event (`IndexOnProfessionalCreated`,
 * `IndexOnProfessionalUpdated`, ...), this takes an `extract` function
 * and is registered once per event type in `compose.ts`. All those
 * classes would have had identical bodies; the only thing that differs
 * per event is which id to pull off it, which is precisely what
 * `extract` is. Returning `null` from `extract` means "this event needs
 * no index change" — used, for example, by the review events when the
 * review is attached to a company-owned job with no professional.
 *
 * ## A failed enqueue never fails the write
 * `handle` swallows enqueue errors (reporting them through the observer).
 * The write model has already committed and is the source of truth; the
 * index is derived data whose worst case is being briefly stale and whose
 * repair path — a rebuild — already exists. Propagating the error would
 * turn `EventDispatchError` loose in the publishing use case and risk
 * failing a user action that fully succeeded, in exchange for nothing.
 */
export class EnqueueSearchIndexSubscriber<T extends DomainEvent> implements EventHandler<T> {
  constructor(
    private readonly queue: SearchIndexQueue,
    private readonly extract: (event: T) => Omit<SearchIndexRequest, "eventId"> | null,
    private readonly observer: SearchObserver = nullSearchObserver,
  ) {}

  async handle(event: T): Promise<void> {
    const request = this.extract(event);
    if (!request) return;

    try {
      await this.queue.enqueue({ ...request, eventId: event.eventId, reason: request.reason ?? event.eventName });
    } catch (error) {
      this.observer.onError({
        operation: "enqueue",
        kind: request.kind,
        entityId: request.entityId,
        error,
      });
    }
  }
}
