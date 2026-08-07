import type { SearchIndexProvider } from "@/application/ports/search-index-provider";
import type { QueueCounts } from "@/infrastructure/jobs/job-types";
import type { SearchSyncSnapshot } from "@/infrastructure/search/search-sync-state";

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * The shape `/api/health/ready` reports for the search engine, joining
 * `checks.cache` (Module 44), `checks.queue` (Module 45) and
 * `checks.cachingLayer` (Module 46) in that route's established
 * "operational visibility only" category — reported, never allowed to
 * change the response's overall status or HTTP code.
 *
 * The reasoning is the strongest of any of those four. The search index
 * is *derived* data: Postgres remains the source of truth, the read side
 * degrades to an empty flagged result when the engine is unreachable
 * (`SearchReadModelUseCase`), and any divergence is repairable by a
 * rebuild. An instance whose search engine is down can still serve every
 * page, take every booking, and process every payment — returning 503 for
 * it would trigger a pointless failover that cannot fix the actual
 * problem.
 *
 * `"disabled"` (indexing switched off via `SEARCH_INDEXING_ENABLED=false`)
 * is a healthy, deliberate state, exactly like `checks.cache`'s
 * `"not_configured"` and `checks.queue`'s `"disabled"`.
 *
 * What is reported is chosen to answer the four questions an operator
 * actually asks about an eventually-consistent read model: *is the engine
 * up* (`provider`), *does it have my data* (`documentCount`), *is the
 * pipeline moving* (`queue` + `sync.lastSuccessfulSyncAt`), and *which
 * schema am I looking at* (`indexVersion`/`indexName`).
 */
export type SearchEngineHealthStatus = "ok" | "degraded" | "disabled";

export interface SearchEngineHealthReport {
  status: SearchEngineHealthStatus;
  /** `"meilisearch"` | `"typesense"` | `"memory"`. */
  provider: string;
  reachable: boolean;
  indexName: string;
  indexVersion: number;
  /** Documents currently in the index, or `null` when the engine could not be asked. */
  documentCount: number | null;
  latencyMs: number | null;
  /** Whether the event → job → worker indexing pipeline is wired up in this process. */
  indexingEnabled: boolean;
  /** Counts for the search-index queue and its dead-letter queue. */
  queue: Record<string, QueueCounts>;
  sync: {
    lastSuccessfulSyncAt: string | null;
    lastOperation: string | null;
    totalSyncs: number;
    totalFailures: number;
    lastFailureAt: string | null;
    lastFailureMessage: string | null;
  };
  /** Present only when the engine could not be reached. */
  error?: string;
}

export const DISABLED_SEARCH_ENGINE_HEALTH: SearchEngineHealthReport = {
  status: "disabled",
  provider: "none",
  reachable: false,
  indexName: "",
  indexVersion: 0,
  documentCount: null,
  latencyMs: null,
  indexingEnabled: false,
  queue: {},
  sync: {
    lastSuccessfulSyncAt: null,
    lastOperation: null,
    totalSyncs: 0,
    totalFailures: 0,
    lastFailureAt: null,
    lastFailureMessage: null,
  },
};

export interface SearchHealthInputs {
  provider: SearchIndexProvider;
  indexName: string;
  indexVersion: number;
  indexingEnabled: boolean;
  queues: readonly { readonly name: string; getCounts(): Promise<QueueCounts> }[];
  sync: SearchSyncSnapshot;
}

/**
 * Collects the report. Never throws — a failing health *check* must not
 * itself become an incident, so both the provider ping (which is
 * contractually total already) and the queue counts are folded into the
 * payload rather than propagated. This mirrors `collectQueueHealth`
 * (Module 45) and `checkCache` (Module 44) exactly.
 */
export async function collectSearchEngineHealth(inputs: SearchHealthInputs): Promise<SearchEngineHealthReport> {
  const status = await inputs.provider.ping();

  const queue: Record<string, QueueCounts> = {};
  let queueError: string | undefined;
  try {
    for (const source of inputs.queues) {
      queue[source.name] = await source.getCounts();
    }
  } catch (error) {
    queueError = error instanceof Error ? error.message : String(error);
  }

  const reachable = status.reachable && queueError === undefined;

  return {
    // "degraded", never "error": the platform is fine, one optional
    // subsystem is not — and the word an operator reads should say so.
    status: reachable ? "ok" : "degraded",
    provider: status.provider,
    reachable: status.reachable,
    indexName: inputs.indexName,
    indexVersion: inputs.indexVersion,
    documentCount: status.documentCount,
    latencyMs: status.latencyMs,
    indexingEnabled: inputs.indexingEnabled,
    queue,
    sync: {
      lastSuccessfulSyncAt: inputs.sync.lastSuccessfulSyncAt?.toISOString() ?? null,
      lastOperation: inputs.sync.lastOperation,
      totalSyncs: inputs.sync.totalSyncs,
      totalFailures: inputs.sync.totalFailures,
      lastFailureAt: inputs.sync.lastFailureAt?.toISOString() ?? null,
      lastFailureMessage: inputs.sync.lastFailureMessage,
    },
    ...(status.error ?? queueError ? { error: status.error ?? queueError } : {}),
  };
}
