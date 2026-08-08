import type { DomainEvent } from "@/domain/events/domain-event";
import type { EventHandler } from "@/application/ports/event-bus";
import { nullAnalyticsObserver, type AnalyticsObserver } from "@/application/ports/analytics-observer";
import type { AnalyticsRefreshQueue } from "@/application/ports/analytics-refresh-queue";

/**
 * Module 50 — Analytics Dashboard (CQRS Read Model).
 *
 * The bridge from a domain event to the refresh pipeline — the analytics
 * analogue of Module 47's `EnqueueSearchIndexSubscriber`, and just as
 * deliberately the least capable class in this module: it holds only an
 * `AnalyticsRefreshQueue`, never an `AnalyticsDashboardAssembler` or a
 * Prisma repository, so it is *structurally* incapable of running the
 * (several-query, Postgres-hitting) recompute inline, inside the
 * publisher's own call stack. The platform's default `SynchronousEventBus`
 * dispatches every subscriber inline — a subscriber that recomputed
 * directly would put several aggregate queries on the critical path of,
 * say, creating a review, and would fail or slow that request whenever
 * Postgres was briefly under load. Enqueuing keeps the request path local
 * and fast; the actual recompute happens later, in a background worker,
 * where retries and dead-lettering already exist (Module 45).
 *
 * One class, registered once per subscribed event in `compose.ts` (see
 * `EnqueueSearchIndexSubscriber`'s own doc comment for why this shape
 * beats a handler class per event) — every subscription supplies only the
 * `reason` label the resulting job/log line should carry; the event's own
 * fields are otherwise unused, because every trigger enqueues the exact
 * same "recompute the dashboard" request (see
 * `RefreshAnalyticsReadModelUseCase`'s doc comment for why there is
 * nothing more specific to extract).
 *
 * A failed enqueue never fails the write that published the triggering
 * event — reported through the observer, then swallowed, the same
 * contract `EnqueueSearchIndexSubscriber.handle` follows.
 */
export class EnqueueAnalyticsRefreshSubscriber<T extends DomainEvent> implements EventHandler<T> {
  constructor(
    private readonly queue: AnalyticsRefreshQueue,
    private readonly reason: string,
    private readonly observer: AnalyticsObserver = nullAnalyticsObserver,
  ) {}

  async handle(event: T): Promise<void> {
    try {
      await this.queue.enqueue({ reason: this.reason, eventId: event.eventId });
    } catch (error) {
      this.observer.onRefreshFailed({ trigger: "event", reason: this.reason, error });
    }
  }
}
