import type { LoadTestExecutor } from "@/application/ports/load-test-executor";
import { LoadTestResult } from "@/domain/entities/load-test-result";
import type { PerformanceScenario } from "@/domain/entities/performance-scenario";
import { LatencyStatistics } from "@/domain/value-objects/latency-distribution";

export interface LoadTestingServiceDependencies {
  executor: LoadTestExecutor;
  generateId: () => string;
  now: () => Date;
}

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * Orchestrates one scenario run end to end: schedule → run via the
 * `LoadTestExecutor` port → aggregate raw samples into `LatencyStatistics`
 * and throughput/error-rate metrics. Structurally the closest analogue is
 * `CreateBackupUseCase` (Module 54), minus persistence: this module is a
 * dev/CI-only engineering tool, not production business logic, so a
 * `LoadTestResult` lives only in memory for the duration of a run/report —
 * there is no database, repository, or record of past runs beyond
 * whatever the caller (e.g. `GenerateCapacityReportUseCase`, or the
 * `capacity-report` CLI script) chooses to keep or write to a report
 * file itself.
 *
 * ## Fail safely
 * The `LoadTestResult` state machine is unchanged from its original
 * design: `schedule()` → `markRunning()` → `markCompleted()`/`markFailed()`
 * still models the full lifecycle in memory, so a caller inspecting the
 * returned (or thrown-with) result always sees an accurate status — only
 * the "persist at every transition" step was removed, since there is no
 * longer anywhere to persist to.
 */
export class LoadTestingService {
  constructor(private readonly deps: LoadTestingServiceDependencies) {}

  async run(scenario: PerformanceScenario, seed?: number): Promise<LoadTestResult> {
    const resolvedSeed = seed ?? null;
    const result = LoadTestResult.schedule(this.deps.generateId(), scenario.id, resolvedSeed, this.deps.now());
    result.markRunning(this.deps.now());

    try {
      // `BenchmarkRunner` (the only executor implementation today) expects
      // an actual numeric seed even when the caller didn't pin one —
      // deriving it from the scheduled result's own id keeps "no seed
      // given" reproducible too (the same id always derives the same
      // seed), rather than silently falling back to non-deterministic
      // randomness the module's whole design tries to avoid.
      const effectiveSeed = resolvedSeed ?? deriveSeedFromId(result.id);
      const outcome = await this.deps.executor.execute(scenario, effectiveSeed);

      if (outcome.samples.length === 0) {
        throw new Error(`LoadTestExecutor produced zero samples for scenario "${scenario.id}".`);
      }

      const latencies = outcome.samples.map((sample) => sample.latencyMs);
      const totalRequests = outcome.samples.length;
      const failedRequests = outcome.samples.filter((sample) => !sample.succeeded).length;
      const timedOutRequests = outcome.samples.filter((sample) => sample.timedOut).length;
      const retriedRequests = outcome.samples.filter((sample) => sample.retried).length;

      const elapsedSeconds = Math.max(1, scenario.workloadProfile.durationSeconds);
      const throughput = {
        requestsPerSecond: totalRequests / elapsedSeconds,
        transactionsPerSecond: (totalRequests - failedRequests) / elapsedSeconds,
      };

      result.markCompleted(
        {
          latency: LatencyStatistics.fromSamples(latencies),
          throughput,
          resourceEstimate: outcome.resourceEstimate,
          totalRequests,
          failedRequests,
          timedOutRequests,
          retriedRequests,
        },
        this.deps.now(),
      );
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      result.markFailed(reason, this.deps.now());
      throw error;
    }
  }
}

/** Deterministically turns a UUID-shaped id into a 32-bit unsigned seed for `mulberry32` — a simple FNV-1a-style fold, good enough for reproducibility, not for cryptographic use. */
function deriveSeedFromId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
