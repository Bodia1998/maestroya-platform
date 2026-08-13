import { NotFoundError } from "@/domain/errors/domain-error";
import type { PerformanceBaseline } from "@/domain/entities/performance-baseline";
import type { LoadTestResult } from "@/domain/entities/load-test-result";
import type { PerformanceRegression } from "@/domain/entities/performance-regression";
import type { PerformanceBaselineRepository } from "@/domain/repositories/performance-baseline-repository";
import type { BaselineComparisonService } from "@/application/services/performance/baseline-comparison-service";

export interface ComparePerformanceBaselineInput {
  /** The result to evaluate — must belong to the same scenario as the resolved baseline. */
  result: LoadTestResult;
  /** An explicit comparison point the caller already holds (e.g. loaded from a previous report's JSON output, or captured earlier in the same process) — takes priority over `baselineLabel`/the stored baseline when given. */
  baseline?: PerformanceBaseline;
  /** A specific stored baseline label to compare against (e.g. `"pre-v2.3-release"`) — looked up via `PerformanceBaselineRepository.findByScenarioAndLabel` when `baseline` is omitted. Omitted entirely falls back to the scenario's most recently captured stored baseline. */
  baselineLabel?: string;
}

export interface ComparePerformanceBaselineDependencies {
  comparisonService: BaselineComparisonService;
  now: () => Date;
  /** Optional — required only when `input.baseline` is omitted, so this use case can resolve `baselineLabel`/"latest" against the persisted store. */
  baselineRepository?: PerformanceBaselineRepository;
}

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * Compares a `LoadTestResult` against a `PerformanceBaseline` via
 * `BaselineComparisonService.compare`. Supports two call shapes: (1) an
 * explicit `baseline` the caller already holds — the original,
 * fully in-memory "compare any two snapshots" behaviour, still supported
 * for testability and ad hoc comparisons; (2) `baseline` omitted, in
 * which case the scenario's stored baseline is resolved via
 * `baselineRepository` — either a named `baselineLabel` or, when that too
 * is omitted, the most recently captured one — so "compare against the
 * baseline" no longer requires every caller to carry a baseline around in
 * memory or re-load one from a previous report's JSON output. Throws
 * `NotFoundError` when no baseline can be resolved by either path.
 */
export class ComparePerformanceBaselineUseCase {
  constructor(private readonly deps: ComparePerformanceBaselineDependencies) {}

  async execute(input: ComparePerformanceBaselineInput): Promise<PerformanceRegression> {
    const baseline = await this.resolveBaseline(input);
    return this.deps.comparisonService.compare(baseline, input.result, this.deps.now());
  }

  private async resolveBaseline(input: ComparePerformanceBaselineInput): Promise<PerformanceBaseline> {
    if (input.baseline) return input.baseline;

    if (!this.deps.baselineRepository) {
      throw new NotFoundError("PerformanceBaseline", `no baseline supplied and no baselineRepository configured for scenario "${input.result.scenarioId}"`);
    }

    const stored = input.baselineLabel
      ? await this.deps.baselineRepository.findByScenarioAndLabel(input.result.scenarioId, input.baselineLabel)
      : await this.deps.baselineRepository.findLatestByScenario(input.result.scenarioId);

    if (!stored) {
      throw new NotFoundError("PerformanceBaseline", input.baselineLabel ? `${input.result.scenarioId}:${input.baselineLabel}` : input.result.scenarioId);
    }
    return stored;
  }
}
