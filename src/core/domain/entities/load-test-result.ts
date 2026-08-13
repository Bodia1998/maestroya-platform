import { InvalidLoadTestTransitionError } from "@/domain/errors/domain-error";
import type { LatencyStatistics } from "@/domain/value-objects/latency-distribution";

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * `LoadTestResult` is the aggregate for one execution of a
 * `PerformanceScenario` — modelled as a small state machine, exactly the
 * same convention `BackupRecord` (`domain/entities/backup.ts`) establishes
 * for this codebase: "invalid state changes are prevented" is a property
 * of the entity itself, not re-validated ad hoc at every call site.
 *
 * This entity never knows *how* a scenario is simulated — that is
 * `LoadTestExecutor` (`application/ports/load-test-executor.ts`),
 * infrastructure this file has zero imports from. It only knows the
 * lifecycle and how to hold the aggregated metrics
 * `LoadTestingService` computes from raw samples.
 */
export type LoadTestStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

/** Legal `status -> status[]` transitions. Anything not listed here is rejected. */
const ALLOWED_TRANSITIONS: Record<LoadTestStatus, readonly LoadTestStatus[]> = {
  PENDING: ["RUNNING", "FAILED"],
  RUNNING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
};

export interface ThroughputMetrics {
  requestsPerSecond: number;
  transactionsPerSecond: number;
}

/**
 * Simulated, not measured — see `infrastructure/performance/
 * metrics-collector.ts`'s own doc comment for the estimation formula.
 * There is no real OS/DB/cache to sample metrics from here; these figures
 * describe what a real deployment carrying this workload would plausibly
 * need, derived from concurrency and scenario category.
 */
export interface ResourceEstimate {
  cpuPercent: number;
  memoryMB: number;
  dbConnectionPoolUtilizationPercent: number;
  cacheHitRatioPercent: number;
}

export interface LoadTestCompletionDetails {
  latency: LatencyStatistics;
  throughput: ThroughputMetrics;
  resourceEstimate: ResourceEstimate;
  totalRequests: number;
  failedRequests: number;
  timedOutRequests: number;
  retriedRequests: number;
}

/**
 * One execution of a `PerformanceScenario`, from being scheduled through
 * to completion or failure. Constructed only via `LoadTestResult.schedule()`
 * — no public constructor, mirroring `BackupRecord.schedule()`.
 */
export class LoadTestResult {
  private constructor(
    readonly id: string,
    readonly scenarioId: string,
    /** The seed `LoadTestExecutor` was given for this run — `null` when the executor chose its own (still deterministic, just not caller-pinned). Recorded so a report can say "run this exact simulation again." */
    readonly seed: number | null,
    private _status: LoadTestStatus,
    readonly scheduledAt: Date,
    private _startedAt: Date | null,
    private _completedAt: Date | null,
    private _latency: LatencyStatistics | null,
    private _throughput: ThroughputMetrics | null,
    private _resourceEstimate: ResourceEstimate | null,
    private _totalRequests: number,
    private _failedRequests: number,
    private _timedOutRequests: number,
    private _retriedRequests: number,
    private _failureReason: string | null,
  ) {}

  static schedule(id: string, scenarioId: string, seed: number | null, now: Date): LoadTestResult {
    return new LoadTestResult(id, scenarioId, seed, "PENDING", now, null, null, null, null, null, 0, 0, 0, 0, null);
  }

  /** Reconstructs a `LoadTestResult` from persisted state — the repository's own factory, never for a fresh run. */
  static rehydrate(fields: {
    id: string;
    scenarioId: string;
    seed: number | null;
    status: LoadTestStatus;
    scheduledAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    latency: LatencyStatistics | null;
    throughput: ThroughputMetrics | null;
    resourceEstimate: ResourceEstimate | null;
    totalRequests: number;
    failedRequests: number;
    timedOutRequests: number;
    retriedRequests: number;
    failureReason: string | null;
  }): LoadTestResult {
    return new LoadTestResult(
      fields.id,
      fields.scenarioId,
      fields.seed,
      fields.status,
      fields.scheduledAt,
      fields.startedAt,
      fields.completedAt,
      fields.latency,
      fields.throughput,
      fields.resourceEstimate,
      fields.totalRequests,
      fields.failedRequests,
      fields.timedOutRequests,
      fields.retriedRequests,
      fields.failureReason,
    );
  }

  get status(): LoadTestStatus {
    return this._status;
  }

  get startedAt(): Date | null {
    return this._startedAt;
  }

  get completedAt(): Date | null {
    return this._completedAt;
  }

  get latency(): LatencyStatistics | null {
    return this._latency;
  }

  get throughput(): ThroughputMetrics | null {
    return this._throughput;
  }

  get resourceEstimate(): ResourceEstimate | null {
    return this._resourceEstimate;
  }

  get totalRequests(): number {
    return this._totalRequests;
  }

  get failedRequests(): number {
    return this._failedRequests;
  }

  get timedOutRequests(): number {
    return this._timedOutRequests;
  }

  get retriedRequests(): number {
    return this._retriedRequests;
  }

  get failureReason(): string | null {
    return this._failureReason;
  }

  /** Fraction (0..1) of requests that failed outright. `0` when `totalRequests` is `0` — an empty run has no observed errors, not an undefined rate. */
  get errorRate(): number {
    return this._totalRequests === 0 ? 0 : this._failedRequests / this._totalRequests;
  }

  /** Fraction (0..1) of requests that timed out. */
  get timeoutRate(): number {
    return this._totalRequests === 0 ? 0 : this._timedOutRequests / this._totalRequests;
  }

  /** Fraction (0..1) of requests that required at least one retry. */
  get retryRate(): number {
    return this._totalRequests === 0 ? 0 : this._retriedRequests / this._totalRequests;
  }

  private assertTransition(next: LoadTestStatus): void {
    if (!ALLOWED_TRANSITIONS[this._status].includes(next)) {
      throw new InvalidLoadTestTransitionError(`LoadTestResult ${this.id} cannot transition from ${this._status} to ${next}.`);
    }
  }

  markRunning(now: Date): void {
    this.assertTransition("RUNNING");
    this._status = "RUNNING";
    this._startedAt = now;
  }

  markCompleted(details: LoadTestCompletionDetails, now: Date): void {
    this.assertTransition("COMPLETED");
    if (details.failedRequests > details.totalRequests) {
      throw new InvalidLoadTestTransitionError(
        `LoadTestResult ${this.id} cannot complete with failedRequests (${details.failedRequests}) greater than totalRequests (${details.totalRequests}).`,
      );
    }
    this._status = "COMPLETED";
    this._completedAt = now;
    this._latency = details.latency;
    this._throughput = details.throughput;
    this._resourceEstimate = details.resourceEstimate;
    this._totalRequests = details.totalRequests;
    this._failedRequests = details.failedRequests;
    this._timedOutRequests = details.timedOutRequests;
    this._retriedRequests = details.retriedRequests;
  }

  markFailed(reason: string, now: Date): void {
    this.assertTransition("FAILED");
    this._status = "FAILED";
    this._completedAt = now;
    this._failureReason = reason;
  }
}
