import type { SearchDocumentKind } from "@/domain/entities/search-document";

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * The seam an event subscriber uses to say "this entity needs
 * (re)indexing" without knowing anything about queues, workers, or the
 * search engine itself.
 *
 * This port is the mechanical enforcement of the module's hardest rule:
 * **indexing never happens in a request handler.** The platform's default
 * `SynchronousEventBus` dispatches handlers inline, inside the
 * publisher's call stack — so a subscriber that called
 * `SearchIndexProvider.index...()` directly would be doing a network
 * round trip to Meilisearch inside the HTTP request that created the
 * professional, and would fail that request when the engine is down. A
 * subscriber that can *only* reach this port cannot do that: the single
 * thing it can do is enqueue, which is a local, fast, failure-tolerant
 * operation. The actual provider call happens later, in a background
 * worker, where retries and dead-lettering apply.
 *
 * The implementation (`infrastructure/search/search-index-queue-adapter.ts`)
 * is a thin adapter over a Module 45 `Queue` — no second queue
 * implementation is introduced by this module.
 */

export type SearchIndexOperation = "index" | "delete";

export interface SearchIndexRequest {
  operation: SearchIndexOperation;
  kind: SearchDocumentKind;
  /** The write model's id for the entity to (re)project or remove. */
  entityId: string;
  /**
   * The id of the domain event that caused this request, when there was
   * one. It is what makes de-duplication *correct* rather than merely
   * possible: the enqueued job's id and the worker's idempotency key are
   * both derived from it, so a redelivered event collapses into one
   * indexing run, while a genuinely later edit of the same entity — a new
   * event, a new id — is never mistaken for a duplicate and dropped.
   */
  eventId?: string;
  /** Short label for logs/diagnostics (`"professional.updated"`, ...). Never branched on. */
  reason?: string;
}

export interface SearchIndexQueue {
  /**
   * Schedules the request. Resolves as soon as the job is durably
   * enqueued — never once it has been indexed.
   *
   * Implementations must not throw for an already-scheduled duplicate
   * (that is a success: the work is pending). They *may* throw if the job
   * store itself is unreachable; callers (event subscribers) decide how
   * to handle that, and this module's subscriber treats it as
   * non-fatal — a failed enqueue must never fail the user's write, since
   * the write model is the source of truth and the index can always be
   * repaired by a rebuild.
   */
  enqueue(request: SearchIndexRequest): Promise<void>;
}
