import type { SearchDocumentKind } from "@/domain/entities/search-document";
import type { SearchIndexRequest } from "@/application/ports/search-index-queue";
import type { ActiveJob } from "@/infrastructure/jobs/job-types";

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * The job vocabulary of the indexing pipeline: what a search-index job
 * carries, what its id is, and what its idempotency key is. Small, but
 * this is where the module's exactly-once-*effect* guarantees are
 * actually decided, so all three live together where they can be
 * reviewed as one design rather than three coincidences.
 *
 * This module adds **no** retry, backoff, or dead-letter machinery of its
 * own — Module 45's `Worker` already implements all three
 * (`computeBackoffDelayMs`, `attempts`, `deadLetterQueue`), and
 * `compose.ts` simply configures them. What is genuinely new here is only
 * the *keying*: what counts as "the same indexing work".
 */

export const SEARCH_INDEX_QUEUE_NAME = "search-index";
export const SEARCH_INDEX_DEAD_LETTER_QUEUE_NAME = "search-index-dead-letter";

/** Job payload. Plain and JSON-safe, like every `StoredJob` data (Module 45). */
export interface SearchIndexJobData {
  operation: "index" | "delete" | "rebuild";
  kind?: SearchDocumentKind;
  entityId?: string;
  /** The domain event that caused this job, when there was one. */
  eventId?: string;
  reason?: string;
}

/**
 * The enqueue-time job id — Module 45's first line of idempotency
 * defence (`Queue.add` with a `jobId` de-duplicates outright, returning
 * `null` for a job that already exists).
 *
 * Keyed on the **domain event id**, not just on the entity, and that
 * choice is the crux of the whole design:
 *
 *  - Keying on `entityId` alone would be wrong: a professional edited
 *    twice in a minute would have the second edit silently swallowed as a
 *    "duplicate", and the index would keep the first version forever.
 *  - Keying on nothing (a random id) would be wrong the other way: an
 *    event redelivered by an at-least-once bus would index twice.
 *
 * The event id is exactly the identity of "this thing happened once".
 * Redelivery of the same event collapses; a genuinely new edit is a new
 * event and always gets its own job. When no event id is available
 * (an operator-triggered reindex), the operation/entity pair is used
 * instead, which coalesces concurrent manual requests for the same entity
 * — the desired behaviour there.
 */
export function searchIndexJobId(request: SearchIndexRequest): string {
  const suffix = request.eventId ?? "manual";
  return `search:${request.operation}:${request.kind}:${request.entityId}:${suffix}`;
}

/**
 * The execution-time idempotency key — Module 45's *second* defence
 * (`WorkerIdempotencyOptions`), which covers the case enqueue-time
 * de-duplication cannot: a job that ran successfully but whose completion
 * was lost (worker killed mid-ack) and is therefore delivered again.
 *
 * Intentionally the same string as the job id. The two mechanisms guard
 * different failure modes but share one definition of "the same work",
 * and having them agree is what makes the pipeline's behaviour
 * predictable — a duplicate is a duplicate at both layers, or at neither.
 *
 * Rebuild jobs return `null`, opting out of de-duplication entirely: a
 * rebuild is idempotent by construction (re-index everything, then sweep
 * stale) and is precisely the operation an operator may need to run twice
 * in a row. Suppressing the second run would break the module's own
 * recovery story.
 */
export function searchIndexJobIdempotencyKey(job: ActiveJob<SearchIndexJobData>): string | null {
  const data = job.data;
  if (data.operation === "rebuild") return null;
  return `search:${data.operation}:${data.kind}:${data.entityId}:${data.eventId ?? job.id}`;
}
