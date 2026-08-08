/**
 * Module 50 — Analytics Dashboard (CQRS Read Model).
 *
 * The seam an event subscriber uses to say "the dashboard should be
 * recomputed" without knowing anything about queues, workers, or Prisma —
 * this module's analogue of Module 47's `SearchIndexQueue`, and the same
 * mechanical enforcement of "refreshing never happens in a request
 * handler": a subscriber holding only this port is structurally incapable
 * of running the (multi-query, Postgres-hitting) recompute inline, inside
 * the publisher's own call stack.
 *
 * The implementation (`infrastructure/analytics/
 * analytics-refresh-queue-adapter.ts`) is a thin adapter over a Module 45
 * `Queue`, exactly like `SearchIndexQueueAdapter`.
 */
export interface AnalyticsRefreshRequest {
  /** Short label for logs/diagnostics (`"review.created"`, `"scheduled"`,
   *  `"manual-rebuild"`). Never branched on by the worker — the
   *  recompute is identical regardless of what triggered it (see
   *  docs/MODULE_50_ANALYTICS_DASHBOARD.md, "Why refresh and rebuild are
   *  the same query"). */
  reason: string;
  /** The id of the domain event that caused this request, when there was
   *  one. Absent for scheduled/manual requests. */
  eventId?: string;
}

export interface AnalyticsRefreshQueue {
  /**
   * Schedules a dashboard recompute. Resolves once the job is durably
   * enqueued — never once the dashboard has actually been recomputed.
   *
   * Every event-triggered request coalesces onto the *same* job id (see
   * `analytics-refresh-jobs.ts`) regardless of which event caused it —
   * unlike Module 47's per-entity indexing jobs, there is only one
   * artifact to refresh, so a burst of ten events in the same second
   * should produce one recompute, not ten. A failed enqueue must never
   * fail the write that published the triggering event; the caller
   * (`EnqueueAnalyticsRefreshSubscriber`) treats it as non-fatal.
   */
  enqueue(request: AnalyticsRefreshRequest): Promise<void>;
}
