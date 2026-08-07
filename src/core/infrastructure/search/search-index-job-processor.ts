import type { DeleteSearchDocumentUseCase } from "@/application/use-cases/search-indexing/delete-search-document.use-case";
import type { IndexSearchDocumentUseCase } from "@/application/use-cases/search-indexing/index-search-document.use-case";
import type { RebuildSearchIndexUseCase } from "@/application/use-cases/search-indexing/rebuild-search-index.use-case";
import type { JobProcessor } from "@/infrastructure/jobs/worker";
import type { SearchIndexJobData } from "@/infrastructure/search/search-index-jobs";

export interface SearchIndexJobHandlers {
  index: IndexSearchDocumentUseCase;
  remove: DeleteSearchDocumentUseCase;
  rebuild: RebuildSearchIndexUseCase;
}

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * The `JobProcessor` the search-index `Worker` runs: it maps a job
 * payload onto the matching indexing use case and does nothing else. All
 * the actual behaviour — projection, upsert-or-remove, batching, the
 * stale sweep — lives in the application layer, where it is testable
 * without a worker; this file is the adapter between the two, the exact
 * counterpart of `createEventJobProcessor` in Module 45's
 * `queued-event-bus.ts`.
 *
 * ## Errors are thrown, never handled
 * Every branch lets the use case's exception escape. That is the
 * contract Module 45's `Worker` is built around: a throw means "this
 * attempt failed", and the worker then decides — retry with exponential
 * backoff while attempts remain, otherwise report and move the job to the
 * dead-letter queue with its full payload. Catching here would silently
 * convert a failed index into a successful job and leave the read model
 * permanently stale with no trace, which is the single worst outcome
 * available to this module.
 *
 * A payload missing `kind`/`entityId` for a non-rebuild operation throws
 * too, deliberately: it can only come from a bug or a hand-crafted job,
 * and dead-lettering it (after the configured attempts) preserves the
 * evidence instead of dropping it.
 */
export function createSearchIndexJobProcessor(
  handlers: SearchIndexJobHandlers,
): JobProcessor<SearchIndexJobData> {
  return async (job) => {
    const { operation, kind, entityId } = job.data;

    if (operation === "rebuild") {
      await handlers.rebuild.execute({});
      return;
    }

    if (!kind || !entityId) {
      throw new Error(
        `Malformed search-index job ${job.id}: operation "${operation}" requires both "kind" and "entityId".`,
      );
    }

    if (operation === "delete") {
      await handlers.remove.execute({ kind, entityId });
      return;
    }

    await handlers.index.execute({ kind, entityId });
  };
}
