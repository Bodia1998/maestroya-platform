import type { PerformanceScenario } from "@/domain/entities/performance-scenario";
import type { ResourceEstimate } from "@/domain/entities/load-test-result";

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * One simulated request's outcome. Deliberately the smallest possible
 * shape a scenario simulation can produce — everything
 * `LoadTestingService` needs (`LatencyStatistics.fromSamples`, error/
 * timeout/retry rates) is derivable from an array of these.
 */
export interface RawExecutionSample {
  latencyMs: number;
  succeeded: boolean;
  timedOut: boolean;
  retried: boolean;
}

export interface LoadTestExecutionOutcome {
  samples: readonly RawExecutionSample[];
  /** Estimated, not measured — see `infrastructure/performance/metrics-collector.ts`'s own doc comment. Computed here (by the executor) rather than by `LoadTestingService` because only the concrete simulator knows what it simulated at what concurrency. */
  resourceEstimate: ResourceEstimate;
}

/**
 * The seam `LoadTestingService` depends on for actually running a
 * scenario — the same Dependency Inversion boundary
 * `DatabaseBackupProvider`/`StorageBackupProvider`
 * (`application/ports/`) draw for Module 54. The only concrete
 * implementation today, `BenchmarkRunner`
 * (`infrastructure/performance/benchmark-runner.ts`), is an in-process,
 * seeded simulator — this module's whole point is *not* external
 * benchmarking (see that file's own doc comment) — but nothing above this
 * interface would need to change if a future implementation instead drove
 * a real load-testing backend.
 */
export interface LoadTestExecutor {
  /**
   * Simulates one execution of `scenario`. `seed` makes the run
   * reproducible — the same seed against the same scenario must always
   * produce the same samples, so a capacity report can be regenerated
   * deterministically for review.
   */
  execute(scenario: PerformanceScenario, seed: number): Promise<LoadTestExecutionOutcome>;
}
