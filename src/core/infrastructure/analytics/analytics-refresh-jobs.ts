import type { ActiveJob } from "@/infrastructure/jobs/job-types";

/**
 * Module 50 — Analytics Dashboard (CQRS Read Model).
 *
 * The job vocabulary of the refresh pipeline — this module's analogue of
 * `search-index-jobs.ts`. Adds no retry/backoff/dead-letter machinery of
 * its own (Module 45's `Worker` already implements all three);
 * what is genuinely new here is the *keying*.
 *
 * ## Coalescing, not per-event de-duplication
 * `search-index-jobs.ts` keys on the domain event id, because each event
 * needs its own indexing job (a professional edited twice needs two
 * index writes). This module's read model is a single artifact, so the
 * opposite policy is correct: every event-triggered refresh request
 * shares **one** job id (`REFRESH_JOB_ID`), regardless of which event or
 * how many caused it. `Queue.add`'s enqueue-time de-duplication then
 * means a burst of ten domain events in the same second — e.g. a bulk
 * review import — enqueues (and eventually runs) exactly one recompute,
 * not ten; the recompute that does run reads the *current* state of every
 * table, so it reflects all ten changes regardless of how many jobs were
 * coalesced away. This is the "coalesced, not per-slice" refresh pattern
 * documented on `AnalyticsRefreshQueue`.
 *
 * A rebuild (`operation: "rebuild"`) intentionally does **not** share
 * that id — see `RebuildAnalyticsReadModelUseCase`'s own doc comment for
 * why an operator-triggered rebuild must never be silently coalesced away
 * by a pending automatic refresh.
 */

export const ANALYTICS_REFRESH_QUEUE_NAME = "analytics-refresh";
export const ANALYTICS_REFRESH_DEAD_LETTER_QUEUE_NAME = "analytics-refresh-dead-letter";

/** The single, deterministic id every coalesced (`operation: "refresh"`) job shares. */
const REFRESH_JOB_ID = "analytics:refresh:coalesced";

export interface AnalyticsRefreshJobData {
  operation: "refresh" | "rebuild";
  reason: string;
  eventId?: string;
}

export function analyticsRefreshJobId(data: AnalyticsRefreshJobData): string {
  if (data.operation === "rebuild") {
    // Rebuilds are never coalesced — each manual/scheduled-full trigger
    // is its own job. `eventId` is never set for a rebuild request, so
    // this falls back to a per-enqueue-call unique-enough id via the
    // reason plus a fresh random suffix would defeat retries' own
    // idempotency; instead rebuilds key on reason alone, which is stable
    // enough that two truly simultaneous manual rebuild calls collapse
    // into one (the desired behaviour — an operator double-clicking
    // "rebuild now" should not run it twice).
    return `analytics:rebuild:${data.reason}`;
  }
  return REFRESH_JOB_ID;
}

/**
 * Execution-time idempotency key (Module 45's `Worker.idempotency`) —
 * deliberately **not** shared across jobs the way the enqueue-time id is.
 * A refresh job that ran successfully but whose completion was lost
 * should be safe to just run again (it recomputes the same live query),
 * so this opts every job out of execution-time de-duplication (`null`)
 * rather than risk permanently skipping a legitimate redelivery — the
 * mirror image of `searchIndexJobIdempotencyKey`'s rebuild-only opt-out,
 * chosen here because *every* job in this queue is already idempotent by
 * construction (recompute-and-overwrite), unlike a search index write.
 */
export function analyticsRefreshJobIdempotencyKey(_job: ActiveJob<AnalyticsRefreshJobData>): string | null {
  return null;
}
