/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * The small amount of state the health endpoint needs but the search
 * engine itself cannot tell us: *when this process last successfully
 * synchronized anything into the index*, and what the last failure was.
 *
 * Per-process and in-memory, deliberately — the same accepted trade-off
 * `CacheStatsCollector` (Module 46) and `InMemoryRateLimitRepository`
 * (Module 44) already document. "Last successful sync" answers an
 * operational question about *this instance's* indexing pipeline ("is my
 * worker actually draining the queue, or has it been silently failing for
 * an hour?"), which is exactly a per-instance question. Persisting it to
 * Redis would make it a fleet-wide aggregate and would hide the one
 * failure mode it exists to expose: a single wedged worker.
 *
 * Written only from `createSearchObserver()`'s callbacks, so use cases
 * never touch process-global state and stay trivially unit-testable.
 */
export interface SearchSyncSnapshot {
  lastSuccessfulSyncAt: Date | null;
  /** Which operation last succeeded — `"index"`, `"batch"`, `"rebuild"`, `"delete"`. */
  lastOperation: string | null;
  /** Documents written by that operation. */
  lastDocumentCount: number;
  /** Cumulative successful sync operations since this process started. */
  totalSyncs: number;
  /** Cumulative indexing failures (each one was retried or dead-lettered by the job layer). */
  totalFailures: number;
  lastFailureAt: Date | null;
  lastFailureMessage: string | null;
}

class SearchSyncState {
  private lastSuccessfulSyncAt: Date | null = null;
  private lastOperation: string | null = null;
  private lastDocumentCount = 0;
  private totalSyncs = 0;
  private totalFailures = 0;
  private lastFailureAt: Date | null = null;
  private lastFailureMessage: string | null = null;

  recordSync(operation: string, documentCount: number, completedAt: Date): void {
    this.lastSuccessfulSyncAt = completedAt;
    this.lastOperation = operation;
    this.lastDocumentCount = documentCount;
    this.totalSyncs += 1;
  }

  recordFailure(error: unknown, at: Date = new Date()): void {
    this.totalFailures += 1;
    this.lastFailureAt = at;
    this.lastFailureMessage = error instanceof Error ? error.message : String(error);
  }

  snapshot(): SearchSyncSnapshot {
    return {
      lastSuccessfulSyncAt: this.lastSuccessfulSyncAt,
      lastOperation: this.lastOperation,
      lastDocumentCount: this.lastDocumentCount,
      totalSyncs: this.totalSyncs,
      totalFailures: this.totalFailures,
      lastFailureAt: this.lastFailureAt,
      lastFailureMessage: this.lastFailureMessage,
    };
  }

  reset(): void {
    this.lastSuccessfulSyncAt = null;
    this.lastOperation = null;
    this.lastDocumentCount = 0;
    this.totalSyncs = 0;
    this.totalFailures = 0;
    this.lastFailureAt = null;
    this.lastFailureMessage = null;
  }
}

let state: SearchSyncState | null = null;

export function getSearchSyncState(): SearchSyncState {
  if (!state) state = new SearchSyncState();
  return state;
}

export type { SearchSyncState };
