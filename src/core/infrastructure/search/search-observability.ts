import "server-only";

import type { SearchObserver } from "@/application/ports/search-observer";
import { createErrorReporter } from "@/infrastructure/observability/error-reporter-factory";
import { logger } from "@/infrastructure/observability/logger";
import { getSearchSyncState } from "@/infrastructure/search/search-sync-state";

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * The `SearchObserver` implementation wired into every indexing use case
 * and the read-side use case by `compose.ts`. Like Module 45's
 * `job-observability.ts` and Module 46's `cache-observability.ts`, it
 * introduces no new transport: everything goes through `logger`
 * (Module 25) and `createErrorReporter()` (Module 39, Sentry), so search
 * telemetry lands beside every other module's with no extra operational
 * setup.
 *
 * ## What is reported where, and why
 * - `indexed` / `removed` → `logger.debug`. One line per document, high
 *   volume, individually uninteresting; invaluable when tracing why one
 *   professional isn't showing up, noise otherwise. Gated out by
 *   `LOG_LEVEL` in production by default.
 * - `batchIndexed` / `rebuildProgress` → `logger.info`. Infrequent,
 *   coarse-grained, and genuinely useful during an operational rebuild
 *   (a long-running task with no other progress channel).
 * - `degraded` (a *read* failed and returned an empty result) →
 *   `logger.warn` **plus** a Sentry report. No request failed — that is
 *   the design — but customers are being shown "no results" for a
 *   systemic reason, which is precisely the sort of silent failure that
 *   otherwise goes unnoticed for days. Warn, not error, because the
 *   application is behaving as intended.
 * - `error` (a *write* failed) → `logger.error` plus a Sentry report.
 *   Note the deliberate double reporting with Module 45's own
 *   `onFailed`: this fires on every failed attempt with search-specific
 *   context (which entity, which operation), while the job layer reports
 *   once more only when attempts are exhausted and the job is
 *   dead-lettered. The two answer different questions — "what is failing
 *   to index" versus "what work has been permanently lost".
 *
 * `onSyncCompleted` additionally records the "last successful sync"
 * timestamp the health endpoint reports (`search-sync-state.ts`).
 */
export function createSearchObserver(): SearchObserver {
  return {
    onIndexed({ kind, entityId, documentId, durationMs }) {
      logger.debug("search_document_indexed", { kind, entityId, documentId, durationMs });
    },

    onRemoved({ kind, entityId, documentId, reason }) {
      logger.debug("search_document_removed", { kind, entityId, documentId, reason });
    },

    onBatchIndexed({ kind, indexed, removed, durationMs }) {
      logger.info("search_batch_indexed", { kind, indexed, removed, durationMs });
    },

    onRebuildProgress({ kind, batch, indexedSoFar, totalCandidates }) {
      logger.info("search_rebuild_progress", { kind, batch, indexedSoFar, totalCandidates });
    },

    onSyncCompleted({ operation, documentCount, completedAt }) {
      getSearchSyncState().recordSync(operation, documentCount, completedAt);
      logger.debug("search_sync_completed", { operation, documentCount, completedAt: completedAt.toISOString() });
    },

    onDegraded({ operation, error }) {
      logger.warn("search_degraded", { operation, error });

      createErrorReporter().reportException(error, {
        tags: { source: "search-engine", operation, stage: "read" },
      });
    },

    onError({ operation, kind, entityId, error }) {
      getSearchSyncState().recordFailure(error);
      logger.error("search_indexing_failed", { operation, kind, entityId, error });

      createErrorReporter().reportException(error, {
        tags: { source: "search-engine", operation, stage: "write" },
        extra: { kind, entityId },
      });
    },
  };
}
