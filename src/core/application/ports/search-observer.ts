import type { SearchDocumentKind } from "@/domain/entities/search-document";

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * Observability seam for the search read model, in the exact shape
 * Module 46's `CacheObserver` established: an interface in
 * `application/ports/`, a null implementation for tests and for callers
 * that want no telemetry, and a single infrastructure implementation
 * (`infrastructure/search/search-observability.ts`) that reports through
 * the two seams this codebase already has — `logger` and
 * `createErrorReporter()`/Sentry.
 *
 * Application code depends on this interface, never on the logger, so
 * indexing use cases stay pure enough to unit test by asserting on a
 * recording double rather than by capturing console output.
 *
 * `onSyncCompleted` is the one member with a job beyond logging: it is
 * how the "last successful sync" timestamp the health endpoint reports
 * gets recorded (`search-sync-state.ts`). Making that an observer
 * callback rather than a direct write keeps the use cases free of any
 * process-global state.
 */
export interface SearchIndexedEvent {
  kind: SearchDocumentKind;
  entityId: string;
  documentId: string;
  durationMs: number;
}

export interface SearchRemovedEvent {
  kind: SearchDocumentKind;
  entityId: string;
  documentId: string;
  /** Why the document went away: the entity is gone, or no longer eligible. */
  reason: "ineligible" | "requested";
}

export interface SearchBatchIndexedEvent {
  kind: SearchDocumentKind;
  indexed: number;
  removed: number;
  durationMs: number;
}

export interface SearchRebuildProgressEvent {
  kind: SearchDocumentKind;
  batch: number;
  indexedSoFar: number;
  totalCandidates: number;
}

export interface SearchSyncCompletedEvent {
  /** `"index"`, `"batch"`, `"rebuild"`, `"delete"`. */
  operation: string;
  documentCount: number;
  completedAt: Date;
}

export interface SearchDegradedEvent {
  operation: string;
  error: unknown;
}

export interface SearchErrorEvent {
  operation: string;
  kind?: SearchDocumentKind;
  entityId?: string;
  error: unknown;
}

export interface SearchObserver {
  onIndexed(event: SearchIndexedEvent): void;
  onRemoved(event: SearchRemovedEvent): void;
  onBatchIndexed(event: SearchBatchIndexedEvent): void;
  onRebuildProgress(event: SearchRebuildProgressEvent): void;
  /** A sync operation finished successfully — the "last successful sync" signal. */
  onSyncCompleted(event: SearchSyncCompletedEvent): void;
  /**
   * A *read* failed and was degraded to an empty result rather than
   * propagated. Distinct from `onError`: nothing is broken from the
   * user's point of view except that they saw no results, and the
   * appropriate response is a warning plus a trend, not an alert per
   * query.
   */
  onDegraded(event: SearchDegradedEvent): void;
  /** A *write* (indexing) failed. The job layer will retry and, eventually, dead-letter. */
  onError(event: SearchErrorEvent): void;
}

/** Null object — same convention as `nullJobLifecycleObserver` (Module 45). */
export const nullSearchObserver: SearchObserver = {
  onIndexed() {},
  onRemoved() {},
  onBatchIndexed() {},
  onRebuildProgress() {},
  onSyncCompleted() {},
  onDegraded() {},
  onError() {},
};
