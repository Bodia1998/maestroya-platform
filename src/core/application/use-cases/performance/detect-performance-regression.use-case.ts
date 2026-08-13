import type { PerformanceBaseline } from "@/domain/entities/performance-baseline";
import type { LoadTestResult } from "@/domain/entities/load-test-result";
import type { PerformanceRegression } from "@/domain/entities/performance-regression";
import type { LoadTestResultRepository } from "@/domain/repositories/load-test-result-repository";
import type { PerformanceBaselineRepository } from "@/domain/repositories/performance-baseline-repository";
import type { BaselineComparisonService } from "@/application/services/performance/baseline-comparison-service";

export interface DetectPerformanceRegressionInput {
  scenarioId: string;
  /** In-memory results to search for the scenario's most recent `COMPLETED` run — e.g. the output of a fresh `GenerateCapacityReportUseCase` pass, or results re-loaded from a prior report's JSON. Omitted (or empty) falls back to `resultRepository.findLatestByScenario` when a repository is configured. */
  results?: readonly LoadTestResult[];
  /** In-memory baselines to search for the scenario's most recently captured one. Omitted (or empty) falls back to `baselineRepository.findLatestByScenario` when a repository is configured. */
  baselines?: readonly PerformanceBaseline[];
}

export interface DetectPerformanceRegressionDependencies {
  comparisonService: BaselineComparisonService;
  now: () => Date;
  /** Optional — consulted only when `input.results` is omitted/empty. */
  resultRepository?: LoadTestResultRepository;
  /** Optional — consulted only when `input.baselines` is omitted/empty. */
  baselineRepository?: PerformanceBaselineRepository;
}

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * The "is the latest run for this scenario a regression?" entry point —
 * distinct from `ComparePerformanceBaselineUseCase` (which compares one
 * *specific, already-known* result/baseline pair) in that this one
 * resolves "latest completed result" and "latest captured baseline" for
 * the scenario itself. Prefers caller-supplied in-memory collections
 * (`input.results`/`input.baselines`) when given — the original,
 * fully in-memory behaviour, still useful for testability and for
 * evaluating a batch of results that were never persisted — and falls
 * back to the configured `resultRepository`/`baselineRepository` when
 * either collection is omitted, so a scheduled post-deploy check or CI
 * gate can ask "did the latest stored run for this scenario regress?"
 * without assembling either collection itself. Returns `null` when the
 * scenario has no completed result, or no baseline, by either path —
 * both unexceptional "nothing to compare" states, never an error.
 */
export class DetectPerformanceRegressionUseCase {
  constructor(private readonly deps: DetectPerformanceRegressionDependencies) {}

  async execute(input: DetectPerformanceRegressionInput): Promise<PerformanceRegression | null> {
    const latestResult = await this.resolveLatestResult(input);
    if (!latestResult) return null;

    const latestBaseline = await this.resolveLatestBaseline(input);
    if (!latestBaseline) return null;

    return this.deps.comparisonService.compare(latestBaseline, latestResult, this.deps.now());
  }

  private async resolveLatestResult(input: DetectPerformanceRegressionInput): Promise<LoadTestResult | null> {
    const fromMemory = latestCompletedResult(input.results ?? [], input.scenarioId);
    if (fromMemory) return fromMemory;
    if (input.results && input.results.length > 0) return null; // caller supplied a collection explicitly; don't silently fall through to the repository.
    if (!this.deps.resultRepository) return null;
    return this.deps.resultRepository.findLatestByScenario(input.scenarioId);
  }

  private async resolveLatestBaseline(input: DetectPerformanceRegressionInput): Promise<PerformanceBaseline | null> {
    const fromMemory = latestBaselineFor(input.baselines ?? [], input.scenarioId);
    if (fromMemory) return fromMemory;
    if (input.baselines && input.baselines.length > 0) return null;
    if (!this.deps.baselineRepository) return null;
    return this.deps.baselineRepository.findLatestByScenario(input.scenarioId);
  }
}

/** The most recently completed result for `scenarioId`, or `null` — "most recent" is by `completedAt`, falling back to array order for results with identical/missing timestamps. */
function latestCompletedResult(results: readonly LoadTestResult[], scenarioId: string): LoadTestResult | null {
  const candidates = results.filter((result) => result.scenarioId === scenarioId && result.status === "COMPLETED" && result.completedAt);
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, candidate) => (candidate.completedAt! > latest.completedAt! ? candidate : latest));
}

/** The most recently captured baseline for `scenarioId`, or `null`. */
function latestBaselineFor(baselines: readonly PerformanceBaseline[], scenarioId: string): PerformanceBaseline | null {
  const candidates = baselines.filter((baseline) => baseline.scenarioId === scenarioId);
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, candidate) => (candidate.capturedAt > latest.capturedAt ? candidate : latest));
}
