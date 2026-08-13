import type { PerformanceBaseline } from "@/domain/entities/performance-baseline";

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * Repository for `PerformanceBaseline` — the persisted comparison point
 * `BaselineComparisonService` diffs later runs against. A baseline must
 * remain persistent so future executions (a later CI run, a later `npm
 * run capacity-report` invocation, days or weeks apart) compare against
 * the *same* reference point rather than requiring every caller to carry
 * one around in memory or re-load it from a previous report's JSON.
 */
export interface PerformanceBaselineRepository {
  /** Upserts on `(scenarioId, label)` — capturing a baseline under a label that already exists for the scenario replaces it, since a label names "the current comparison point for this purpose", not an append-only log. */
  save(baseline: PerformanceBaseline): Promise<void>;

  /** A specific labelled baseline for a scenario (e.g. `"pre-v2.3-release"`), or `null` if never captured. */
  findByScenarioAndLabel(scenarioId: string, label: string): Promise<PerformanceBaseline | null>;

  /** The most recently captured baseline for a scenario, regardless of label — `BaselineComparisonService`'s default comparison point when a caller does not name a specific one. */
  findLatestByScenario(scenarioId: string): Promise<PerformanceBaseline | null>;

  /** Every baseline captured for a scenario, newest first. */
  list(scenarioId: string): Promise<PerformanceBaseline[]>;
}
