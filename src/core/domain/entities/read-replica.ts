/**
 * Module 55 — Read Replicas.
 *
 * The pure, backend-independent domain model for one replica's *observed
 * health* — a small state machine, the same convention `BackupRecord`
 * (`domain/entities/backup.ts`) establishes for this codebase: "a value
 * only ever moves through legal transitions" is a property of the
 * entity itself, never re-validated ad hoc at every call site.
 *
 * `ReplicaHealth` never knows *how* a replica is pinged or how
 * replication lag is measured — that is `ReplicaHealthChecker`
 * (`application/ports/replica-health-checker.ts`), an infrastructure
 * concern this file has zero imports from. This file only knows the
 * *circuit-breaker bookkeeping*: how many consecutive successes/failures
 * flip the state, and whether a given lag reading is within an
 * eligibility bound — both pure, both independent of Postgres, Prisma,
 * or any concrete replica count.
 */

/**
 * `HEALTHY` — eligible for read routing.
 * `DEGRADED` — has failed at least once since its last success, but not
 * yet enough consecutive times to be excluded; still eligible, a
 * deliberate "one blip is not an outage" tolerance.
 * `UNHEALTHY` — tripped the circuit breaker (reached the configured
 * consecutive-failure threshold, or its last known lag reading exceeded
 * the configured maximum) — excluded from selection until it recovers.
 * `UNKNOWN` — no successful health signal has ever been recorded (a
 * freshly constructed replica, or one whose last known signal is stale
 * enough to no longer be trusted) — treated as ineligible, the same
 * "absence of a positive signal is not evidence of health" rule
 * `RecoveryReadinessService` applies to a target with no completed
 * backup.
 */
export type ReplicaHealthState = "HEALTHY" | "DEGRADED" | "UNHEALTHY" | "UNKNOWN";

/**
 * Replication lag, as reported by the replica's own driver
 * (`pg_last_xact_replay_timestamp()` for streaming Postgres replication).
 * A plain, immutable value object with no persistence concerns of its
 * own — the same role `RetentionPolicy` (`domain/entities/backup.ts`)
 * plays for its module.
 */
export class ReplicationLag {
  constructor(readonly milliseconds: number) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new RangeError(`ReplicationLag.milliseconds must be a finite number >= 0, received ${String(milliseconds)}.`);
    }
  }

  exceeds(thresholdMs: number): boolean {
    return this.milliseconds > thresholdMs;
  }
}

export interface ReplicaHealthThresholds {
  /** Consecutive ping/query failures before a replica trips to `UNHEALTHY`. */
  readonly failureThreshold: number;
  /** Consecutive successes an `UNHEALTHY`/`DEGRADED` replica needs before returning to `HEALTHY`. */
  readonly recoveryThreshold: number;
  /** A replica whose most recent lag reading exceeds this is `UNHEALTHY` regardless of its success streak. */
  readonly maxLagMs: number;
}

export interface ReplicaHealthSnapshot {
  readonly replicaId: string;
  readonly state: ReplicaHealthState;
  readonly consecutiveFailures: number;
  readonly consecutiveSuccesses: number;
  readonly lastLatencyMs: number | null;
  readonly lastLagMs: number | null;
  readonly lastCheckedAt: Date | null;
  readonly lastError: string | null;
}

/**
 * One replica's health, tracked in-process. Constructed once per replica
 * by `ReplicaRouterService` and mutated as real query attempts and active
 * health-check pings report their outcome — never persisted, never
 * shared across processes, exactly like `CacheManager`'s own in-memory
 * hit/miss counters (`application/services/cache/cache-stats.ts`): this
 * is operational bookkeeping for *this* instance's own routing decisions,
 * not a durable record.
 */
export class ReplicaHealth {
  private _state: ReplicaHealthState = "UNKNOWN";
  private _consecutiveFailures = 0;
  private _consecutiveSuccesses = 0;
  private _lastLatencyMs: number | null = null;
  private _lastLagMs: number | null = null;
  private _lastCheckedAt: Date | null = null;
  private _lastError: string | null = null;

  constructor(
    readonly replicaId: string,
    private readonly thresholds: ReplicaHealthThresholds,
  ) {}

  /**
   * Records a successful ping/query against this replica.
   *
   * `lag` has three meaningful states: an actual `ReplicationLag`
   * reading (from an active health-check ping), `null` (explicitly
   * measured — there is no meaningful lag, e.g. the target is not
   * currently in recovery), or `undefined` — "this success carries no
   * lag information" (a passive, organic query succeeding tells us
   * nothing about *how stale* the data was, only that the connection is
   * up) — in which case the previously recorded `lastLagMs` is left
   * untouched rather than being wiped to `null`. This is what lets
   * `read-replica-extension.ts` report every successful organic read
   * without the active monitor's own lag measurement being overwritten
   * between polls.
   */
  recordSuccess(latencyMs: number, lag: ReplicationLag | null | undefined, now: Date): void {
    this._consecutiveFailures = 0;
    this._consecutiveSuccesses += 1;
    this._lastLatencyMs = latencyMs;
    if (lag !== undefined) this._lastLagMs = lag?.milliseconds ?? null;
    this._lastCheckedAt = now;
    this._lastError = null;

    if (lag && lag.exceeds(this.thresholds.maxLagMs)) {
      this._state = "UNHEALTHY";
      return;
    }

    if (this._state === "UNKNOWN") {
      this._state = "HEALTHY";
    } else if (this._state !== "HEALTHY" && this._consecutiveSuccesses >= this.thresholds.recoveryThreshold) {
      this._state = "HEALTHY";
    }
  }

  /** Records a failed ping/query against this replica. */
  recordFailure(error: string, now: Date): void {
    this._consecutiveSuccesses = 0;
    this._consecutiveFailures += 1;
    this._lastCheckedAt = now;
    this._lastError = error;

    if (this._consecutiveFailures >= this.thresholds.failureThreshold) {
      this._state = "UNHEALTHY";
    } else if (this._state === "HEALTHY" || this._state === "UNKNOWN") {
      this._state = "DEGRADED";
    }
  }

  /**
   * Whether this replica may currently be selected for a read. `UNKNOWN`
   * and `UNHEALTHY` are excluded; `DEGRADED` is deliberately still
   * eligible (see the type's own doc comment). `maxStaleAgeMs` additionally
   * excludes a replica whose last signal is too old to be trusted —
   * `null` disables that check (used when the caller has its own
   * freshness policy, e.g. an active monitor that just pinged everything).
   */
  isEligible(now: Date, maxStaleAgeMs: number | null): boolean {
    if (this._state === "UNKNOWN" || this._state === "UNHEALTHY") return false;
    if (maxStaleAgeMs === null) return true;
    if (this._lastCheckedAt === null) return false;
    return now.getTime() - this._lastCheckedAt.getTime() <= maxStaleAgeMs;
  }

  get state(): ReplicaHealthState {
    return this._state;
  }

  get lastLagMs(): number | null {
    return this._lastLagMs;
  }

  toSnapshot(): ReplicaHealthSnapshot {
    return {
      replicaId: this.replicaId,
      state: this._state,
      consecutiveFailures: this._consecutiveFailures,
      consecutiveSuccesses: this._consecutiveSuccesses,
      lastLatencyMs: this._lastLatencyMs,
      lastLagMs: this._lastLagMs,
      lastCheckedAt: this._lastCheckedAt,
      lastError: this._lastError,
    };
  }
}
