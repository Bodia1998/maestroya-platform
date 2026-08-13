import { InvalidWorkloadProfileError } from "@/domain/errors/domain-error";

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * A `PerformanceScenario` describes one realistic workload shape this
 * platform can simulate in-process — never a real external call (no
 * outbound HTTP, no real Stripe call for `STRIPE_PAYMENT_FLOW`; see
 * `infrastructure/performance/benchmark-runner.ts`'s own doc comment for
 * why the simulator stays entirely in-process). The scenario itself only
 * describes *what* is being simulated and at what concurrency — *how* the
 * simulation actually produces samples is `LoadTestExecutor`'s job
 * (`application/ports/load-test-executor.ts`), the same Dependency
 * Inversion boundary `DatabaseBackupProvider` draws for Module 54.
 */
export type ScenarioCategory =
  | "USER_REGISTRATION"
  | "AUTHENTICATION"
  | "PASSWORD_RESET"
  | "SEARCH"
  | "CREATE_SERVICE_REQUEST"
  | "BROWSE_PROFESSIONALS"
  | "SUBMIT_QUOTE"
  | "ACCEPT_QUOTE"
  | "BOOKING"
  | "MESSAGING"
  | "NOTIFICATIONS"
  | "STRIPE_PAYMENT_FLOW"
  | "ADMIN_DASHBOARD"
  | "CONCURRENT_API_TRAFFIC"
  | "DATABASE_INTENSIVE"
  | "MIXED_WORKLOAD";

/**
 * The shape of load a scenario asks the executor to simulate. A
 * self-validating value object — same "throw in the constructor, never
 * let an invalid instance exist" convention `RetentionPolicy`
 * (`domain/entities/backup.ts`) establishes — but this module raises the
 * more specific `InvalidWorkloadProfileError` rather than a bare
 * `RangeError`, so `ExecuteLoadTestUseCase` callers can distinguish "the
 * requested workload itself is malformed" from any other domain failure
 * without string-matching a message.
 */
export class WorkloadProfile {
  constructor(
    /** Concurrent simulated users/sessions active during the steady-state window. */
    readonly virtualUsers: number,
    /** Total simulated duration, including ramp-up. */
    readonly durationSeconds: number,
    /** How long virtual users are simulated to ramp up to `virtualUsers`, from zero. Never longer than `durationSeconds`. */
    readonly rampUpSeconds: number,
    /** Requests each virtual user is simulated to issue per second during steady state. Defaults to `1` — one logical action per user per second — when omitted. */
    readonly requestsPerUserPerSecond: number = 1,
  ) {
    if (!Number.isInteger(virtualUsers) || virtualUsers <= 0) {
      throw new InvalidWorkloadProfileError(`WorkloadProfile.virtualUsers must be a positive integer, received ${String(virtualUsers)}.`);
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new InvalidWorkloadProfileError(`WorkloadProfile.durationSeconds must be a positive number, received ${String(durationSeconds)}.`);
    }
    if (!Number.isFinite(rampUpSeconds) || rampUpSeconds < 0) {
      throw new InvalidWorkloadProfileError(`WorkloadProfile.rampUpSeconds must be a non-negative number, received ${String(rampUpSeconds)}.`);
    }
    if (rampUpSeconds > durationSeconds) {
      throw new InvalidWorkloadProfileError(
        `WorkloadProfile.rampUpSeconds (${rampUpSeconds}) cannot exceed durationSeconds (${durationSeconds}).`,
      );
    }
    if (!Number.isFinite(requestsPerUserPerSecond) || requestsPerUserPerSecond <= 0) {
      throw new InvalidWorkloadProfileError(
        `WorkloadProfile.requestsPerUserPerSecond must be a positive number, received ${String(requestsPerUserPerSecond)}.`,
      );
    }
  }

  /** The steady-state window, after ramp-up completes — the portion of the run `BenchmarkRunner` treats as representative. */
  get steadyStateSeconds(): number {
    return this.durationSeconds - this.rampUpSeconds;
  }

  /** A rough upper bound on total simulated requests across the whole run — used by `BenchmarkRunner` to size its sample set. Ramp-up is modelled as running, on average, at half concurrency. */
  estimatedTotalRequests(): number {
    const rampUpRequests = this.virtualUsers * this.requestsPerUserPerSecond * this.rampUpSeconds * 0.5;
    const steadyStateRequests = this.virtualUsers * this.requestsPerUserPerSecond * this.steadyStateSeconds;
    return Math.max(1, Math.round(rampUpRequests + steadyStateRequests));
  }
}

/**
 * One realistic, named workload this platform can simulate. Constructed
 * only via `PerformanceScenario.define()` — there is no public
 * constructor, mirroring `BackupRecord`'s "aggregates come from a named
 * factory" convention, even though this class has no lifecycle of its
 * own (it is a definition, not a state machine — the state machine is
 * `LoadTestResult`, one *execution* of a scenario).
 *
 * The full catalog of scenarios ships as reviewed, deployed code
 * (`application/services/performance/performance-scenario-catalog.ts`),
 * not a database table — identical reasoning to
 * `disaster-recovery-plans.ts`'s own doc comment for Module 54: a
 * workload definition is exactly as load-bearing as code, and admin-
 * editable scenario definitions would make capacity reports impossible to
 * compare across time.
 */
export class PerformanceScenario {
  private constructor(
    readonly id: string,
    readonly name: string,
    readonly category: ScenarioCategory,
    readonly description: string,
    readonly workloadProfile: WorkloadProfile,
    /** Simulated pause between one virtual user's requests, in milliseconds — informational; folded into `BenchmarkRunner`'s pacing, not a separate validated input here. */
    readonly thinkTimeMs: number,
    /** Relative weight (> 0) this scenario carries inside a `MIXED_WORKLOAD` composite run — ignored for any scenario run standalone. */
    readonly weight: number,
  ) {}

  static define(fields: {
    id: string;
    name: string;
    category: ScenarioCategory;
    description: string;
    workloadProfile: WorkloadProfile;
    thinkTimeMs?: number;
    weight?: number;
  }): PerformanceScenario {
    if (!fields.id.trim()) {
      throw new InvalidWorkloadProfileError("PerformanceScenario.id must not be empty.");
    }
    const thinkTimeMs = fields.thinkTimeMs ?? 0;
    const weight = fields.weight ?? 1;
    if (!Number.isFinite(thinkTimeMs) || thinkTimeMs < 0) {
      throw new InvalidWorkloadProfileError(`PerformanceScenario.thinkTimeMs must be a non-negative number, received ${String(thinkTimeMs)}.`);
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new InvalidWorkloadProfileError(`PerformanceScenario.weight must be a positive number, received ${String(weight)}.`);
    }
    return new PerformanceScenario(fields.id, fields.name, fields.category, fields.description, fields.workloadProfile, thinkTimeMs, weight);
  }
}
