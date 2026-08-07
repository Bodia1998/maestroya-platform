import type { SearchIndexQueue, SearchIndexRequest } from "@/application/ports/search-index-queue";
import type { JobOptions } from "@/infrastructure/jobs/job-types";
import type { Queue } from "@/infrastructure/jobs/queue";
import { searchIndexJobId, type SearchIndexJobData } from "@/infrastructure/search/search-index-jobs";

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * Implements the application-layer `SearchIndexQueue` port over a
 * Module 45 `Queue`. Thin by design — its whole job is to keep the
 * `Queue`/`JobOptions` vocabulary out of the application layer, so an
 * event subscriber depends on "I can request indexing" and not on "there
 * is a job queue with attempts and backoff".
 *
 * The retry policy lives here rather than in the worker because it is a
 * property of the *enqueued job* in Module 45's model (`JobOptions.attempts`
 * / `.backoff`), and it reuses the exact settings the queued event bus
 * already uses: exponential backoff from 1s with 20% jitter, so a batch
 * of documents that all failed on the same engine outage does not retry
 * in lockstep and re-DDoS it on recovery.
 *
 * A `null` return from `Queue.add` (a job with this id already exists) is
 * a success and is ignored — that is the enqueue-time de-duplication
 * described in `search-index-jobs.ts`, working as intended.
 */
export class SearchIndexQueueAdapter implements SearchIndexQueue {
  constructor(
    private readonly queue: Queue<SearchIndexJobData>,
    private readonly jobOptions: JobOptions,
  ) {}

  async enqueue(request: SearchIndexRequest): Promise<void> {
    await this.queue.add(
      `search.${request.operation}`,
      {
        operation: request.operation,
        kind: request.kind,
        entityId: request.entityId,
        eventId: request.eventId,
        reason: request.reason,
      },
      { ...this.jobOptions, jobId: searchIndexJobId(request) },
    );
  }
}
