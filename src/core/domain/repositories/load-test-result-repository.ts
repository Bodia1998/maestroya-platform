import type { CapacityBottleneck, CapacityRecommendation } from "@/domain/entities/capacity-report";
import type { LoadTestResult } from "@/domain/entities/load-test-result";

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * Repository for `LoadTestRun` rows — **aggregated** load-test evidence
 * only, never raw per-request samples. A `LoadTestResult` already only
 * ever carries `LatencyStatistics` (six computed numbers), never the raw
 * latency array they came from — see `latency-distribution.ts`'s own doc
 * comment — so persisting the aggregate exactly as it already exists in
 * memory never risks leaking raw samples into storage.
 *
 * `save()` takes an optional `reportSnapshot` so the same method call
 * that persists an ordinary per-scenario execution can, for the single
 * row that anchors a full `npm run capacity-report` run, additionally
 * carry the report's bottlenecks/recommendations/score/rendered text —
 * see `PersistCapacityReportUseCase`.
 */
export interface LoadTestRunReportSnapshot {
  bottlenecks?: readonly CapacityBottleneck[];
  recommendations?: readonly CapacityRecommendation[];
  productionReadinessScore?: number;
  /** The full `StructuredCapacityReport` (see `report-generator.ts`) — a JSON-serializable structured snapshot, never raw samples. */
  reportJson?: unknown;
  reportMarkdown?: string;
}

/** Runtime provenance recorded alongside a `LoadTestRun` — resolved by `infrastructure/performance/runtime-metadata.ts`. */
export interface LoadTestRunMetadata {
  gitCommit?: string | null;
  gitBranch?: string | null;
  appVersion?: string | null;
  environment?: string | null;
}

export interface LoadTestResultRepository {
  /**
   * Persists a `COMPLETED` `LoadTestResult` as one `LoadTestRun` row.
   * `scenarioName` is required because `LoadTestResult` itself only
   * carries `scenarioId` (the catalog is the source of truth for names).
   * `reportSnapshot`/`metadata` are only populated for the row that
   * anchors a full capacity-report run — omit both for an ordinary
   * per-scenario execution.
   */
  save(result: LoadTestResult, scenarioName: string, reportSnapshot?: LoadTestRunReportSnapshot, metadata?: LoadTestRunMetadata): Promise<void>;

  findById(id: string): Promise<LoadTestResult | null>;

  /** The `limit` most recent runs for a scenario, newest first — used so a report reflects only the freshest evidence, not every run ever recorded. */
  findRecentByScenario(scenarioId: string, limit: number): Promise<LoadTestResult[]>;

  /** The single most recent run for a scenario, or `null` when none exists yet — the natural input to a capacity projection or a regression comparison. */
  findLatestByScenario(scenarioId: string): Promise<LoadTestResult | null>;
}
