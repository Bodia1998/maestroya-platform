import { CapacityReport, type CapacityProjection, type CapacityRecommendation } from "@/domain/entities/capacity-report";
import type { LoadTestResult } from "@/domain/entities/load-test-result";
import { PerformanceBaseline } from "@/domain/entities/performance-baseline";
import type { PerformanceScenario } from "@/domain/entities/performance-scenario";
import type { RegressionSeverity } from "@/domain/entities/performance-regression";
import type { LoadTestResultRepository } from "@/domain/repositories/load-test-result-repository";
import type { PerformanceBaselineRepository } from "@/domain/repositories/performance-baseline-repository";
import type { BaselineComparisonService } from "@/application/services/performance/baseline-comparison-service";
import type { CapacityPlanningService } from "@/application/services/performance/capacity-planning-service";
import type { LoadTestingService } from "@/application/services/performance/load-testing-service";
import type { PerformanceAnalysisService } from "@/application/services/performance/performance-analysis-service";
import { PERFORMANCE_SCENARIO_CATALOG } from "@/application/services/performance/performance-scenario-catalog";

/** The label an automatically-captured "first successful run becomes the baseline" baseline is stored under — distinct from any caller-chosen label (e.g. `"pre-v2.3-release"`) captured deliberately. */
export const AUTO_CAPTURED_BASELINE_LABEL = "auto-captured";

export interface GenerateCapacityReportInput {
  /** Restricts the report to these scenario ids; omitted covers the entire catalog (all 16 scenarios). */
  scenarioIds?: readonly string[];
  /** Pins the PRNG seed every scenario is run with, for a fully reproducible report; omitted lets `LoadTestingService` derive a per-run seed. */
  seed?: number;
  /** Explicit baselines (e.g. re-loaded from a previous report's JSON output, or supplied for an arbitrary two-way comparison) to fold regression severity into the readiness score. When omitted for a scenario and `baselineRepository` is configured, the stored baseline (`PerformanceBaselineRepository.findLatestByScenario`) is used instead — see the class doc comment. */
  baselines?: readonly PerformanceBaseline[];
}

export interface GenerateCapacityReportDependencies {
  loadTestingService: LoadTestingService;
  capacityPlanning: CapacityPlanningService;
  analysis: PerformanceAnalysisService;
  comparison: BaselineComparisonService;
  generateId: () => string;
  now: () => Date;
  /** Optional — when supplied, every scenario's aggregated `LoadTestResult` is persisted as one `LoadTestRun` row (never raw samples). Persistence failures are logged and non-fatal: a database outage must never prevent a report from being generated. */
  resultRepository?: LoadTestResultRepository;
  /** Optional — when supplied, this use case (a) compares each scenario against its stored baseline when the caller didn't pass one explicitly, and (b) auto-captures the scenario's first successful run as its baseline when none exists yet ("first successful run becomes the baseline" — see the class doc comment). */
  baselineRepository?: PerformanceBaselineRepository;
}

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * The production-readiness sign-off entry point, and the CLI's (`npm run
 * capacity-report`) main entry point: runs every requested scenario
 * through `LoadTestingService` (which drives `BenchmarkRunner`, an
 * in-process seeded simulator — no external system, no database),
 * projects each fresh result across every `CAPACITY_USER_TIERS` tier
 * (`CapacityPlanningService`), compares it against a baseline where one
 * exists (`BaselineComparisonService`) to fold regression severity into
 * the readiness score, identifies bottlenecks and computes the overall
 * score (`PerformanceAnalysisService`), and assembles the immutable
 * `CapacityReport`.
 *
 * ## Persistence — aggregated only, optional, non-fatal
 * When `resultRepository`/`baselineRepository` are wired (see
 * `infrastructure/performance/compose.ts`), every scenario's aggregated
 * result is persisted, and future runs automatically compare against
 * whatever baseline is stored for the scenario rather than requiring a
 * caller to supply one: `execute()` prefers an explicit `input.baselines`
 * entry when given (still supported, for an arbitrary caller-chosen
 * two-way comparison), falls back to the stored baseline
 * (`findLatestByScenario`) otherwise, and — when neither exists —
 * auto-captures the fresh result as the scenario's baseline under
 * `AUTO_CAPTURED_BASELINE_LABEL`, so the *next* run has something to
 * compare against. Both repositories are optional constructor
 * dependencies: this use case, and `npm run capacity-report`, remain
 * fully functional with neither configured (e.g. no database available)
 * — a save/lookup failure is caught, logged as a warning, and never
 * fails the report itself. Raw per-request samples are never persisted;
 * only the already-aggregated `LatencyStatistics`/throughput/resource
 * figures a `LoadTestResult` already carries.
 *
 * A scenario whose run fails (the executor throws, or produces zero
 * samples) is skipped, not fatal to the whole report — the same "a
 * report reflects whatever evidence currently exists" contract this use
 * case has always documented.
 */
export class GenerateCapacityReportUseCase {
  constructor(private readonly deps: GenerateCapacityReportDependencies) {}

  async execute(input: GenerateCapacityReportInput = {}): Promise<{ report: CapacityReport; results: LoadTestResult[] }> {
    const scenarioIds = input.scenarioIds ?? PERFORMANCE_SCENARIO_CATALOG.map((scenario) => scenario.id);
    const scenarioById = new Map<string, PerformanceScenario>(PERFORMANCE_SCENARIO_CATALOG.map((scenario) => [scenario.id, scenario]));

    const projections: CapacityProjection[] = [];
    const recommendations: CapacityRecommendation[] = [];
    const results: LoadTestResult[] = [];
    const regressionSeverities: RegressionSeverity[] = [];

    for (const scenarioId of scenarioIds) {
      const scenario = scenarioById.get(scenarioId);
      if (!scenario) continue;

      let result: LoadTestResult;
      try {
        result = await this.deps.loadTestingService.run(scenario, input.seed);
      } catch {
        // A scenario run failing (simulator error, zero samples) is
        // unexceptional to the report as a whole — it simply carries no
        // evidence for that scenario, exactly like a missing persisted
        // result did in this use case's earlier, repository-backed form.
        continue;
      }

      results.push(result);

      if (this.deps.resultRepository) {
        try {
          await this.deps.resultRepository.save(result, scenario.name);
        } catch (error) {
          console.warn(`GenerateCapacityReportUseCase: failed to persist LoadTestRun for scenario "${scenarioId}" — continuing without persistence.`, error);
        }
      }

      const scenarioProjections = this.deps.capacityPlanning.projectForScenario(scenario, result);
      projections.push(...scenarioProjections);
      recommendations.push(...this.deps.capacityPlanning.recommendationsFor(scenario, scenarioProjections));

      const baseline = await this.resolveBaseline(input.baselines ?? [], scenarioId, result);
      if (baseline) {
        const regression = this.deps.comparison.compare(baseline, result, this.deps.now());
        regressionSeverities.push(regression.overallSeverity);
      }
    }

    const bottlenecks = this.deps.analysis.identifyBottlenecks(results, scenarioById);
    const productionReadinessScore = this.deps.analysis.computeProductionReadinessScore(bottlenecks, regressionSeverities);

    const report = CapacityReport.build({
      id: this.deps.generateId(),
      generatedAt: this.deps.now(),
      projections,
      recommendations,
      bottlenecks,
      productionReadinessScore,
    });

    return { report, results };
  }

  /**
   * Resolves the comparison baseline for one scenario's fresh `result`,
   * in priority order: (1) an explicit entry in `input.baselines` — an
   * arbitrary caller-chosen comparison always wins; (2) the stored
   * baseline via `baselineRepository.findLatestByScenario` when no
   * explicit one was given; (3) `null` when neither exists, in which case
   * — if a `baselineRepository` is configured — this method auto-captures
   * `result` itself as the scenario's first baseline (under
   * `AUTO_CAPTURED_BASELINE_LABEL`) so the *next* run has one to compare
   * against, and still returns `null` for *this* run (a fresh baseline
   * has nothing meaningful to compare itself to). Every repository call
   * is caught and logged, never fatal to the report.
   */
  private async resolveBaseline(explicitBaselines: readonly PerformanceBaseline[], scenarioId: string, result: LoadTestResult): Promise<PerformanceBaseline | null> {
    const explicit = latestBaselineFor(explicitBaselines, scenarioId);
    if (explicit) return explicit;

    if (!this.deps.baselineRepository) return null;

    try {
      const stored = await this.deps.baselineRepository.findLatestByScenario(scenarioId);
      if (stored) return stored;

      const captured = PerformanceBaseline.capture(this.deps.generateId(), result, AUTO_CAPTURED_BASELINE_LABEL, this.deps.now());
      await this.deps.baselineRepository.save(captured);
      return null;
    } catch (error) {
      console.warn(`GenerateCapacityReportUseCase: failed to resolve/auto-capture PerformanceBaseline for scenario "${scenarioId}" — continuing without a baseline comparison.`, error);
      return null;
    }
  }
}

/** The most recently captured baseline for `scenarioId` among `baselines`, or `null`. */
function latestBaselineFor(baselines: readonly PerformanceBaseline[], scenarioId: string): PerformanceBaseline | null {
  const candidates = baselines.filter((baseline) => baseline.scenarioId === scenarioId);
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, candidate) => (candidate.capturedAt > latest.capturedAt ? candidate : latest));
}
