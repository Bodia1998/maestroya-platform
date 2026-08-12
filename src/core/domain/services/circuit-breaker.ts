import {
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  type CircuitBreakerConfig,
  type CircuitBreakerMetrics,
  type CircuitBreakerSnapshot,
  type CircuitState,
} from "@/domain/entities/circuit-breaker";
import { CircuitBreakerOpenError } from "@/domain/errors/circuit-breaker-open-error";
import { CircuitBreakerTimeoutError } from "@/domain/errors/circuit-breaker-timeout-error";

/**
 * Module 56 — Health Checks & Circuit Breakers.
 *
 * A reusable, infrastructure-independent circuit breaker implementing
 * the standard `CLOSED` → `OPEN` → `HALF_OPEN` state machine (see
 * `domain/entities/circuit-breaker.ts` for each state's meaning).
 *
 * Deliberately has no dependency on Prisma, Redis, HTTP, `fetch`, or any
 * other infrastructure concern — it wraps an arbitrary
 * `() => Promise<T>`, which is what makes it reusable across every
 * external dependency the module protects (Postgres, Redis, Stripe,
 * Cloudinary, Resend, Twilio, OpenTelemetry, analytics, and any future
 * one) without this class ever needing to change. Infrastructure code
 * constructs and names instances (see
 * `infrastructure/health/compose.ts`'s `CircuitBreakerRegistry`); this
 * class only implements the state machine and its metrics.
 *
 * The clock is injectable (`now`, defaulting to `Date.now`) purely for
 * deterministic unit tests of `resetTimeoutMs` transitions — production
 * code never passes it.
 */
export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private readonly now: () => number;

  private state: CircuitState = "CLOSED";
  private openedAtMs: number | null = null;
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;

  private successCount = 0;
  private failureCount = 0;
  private timeoutCount = 0;
  private rejectedCount = 0;
  private recoveryCount = 0;
  private totalLatencyMs = 0;
  private lastFailureAtMs: number | null = null;
  private lastSuccessAtMs: number | null = null;

  constructor(
    private readonly name: string,
    config: Partial<CircuitBreakerConfig> = {},
    now: () => number = Date.now,
  ) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
    this.now = now;
  }

  /** Current state, first checking whether an `OPEN` breaker's `resetTimeoutMs` has elapsed. */
  get currentState(): CircuitState {
    this.maybeTransitionToHalfOpen();
    return this.state;
  }

  /**
   * Runs `fn` through the breaker. Rejects immediately with
   * `CircuitBreakerOpenError` — without invoking `fn` — while `OPEN`.
   * Otherwise runs `fn` (racing it against `config.timeoutMs`, if set)
   * and records the outcome before resolving/rejecting with it.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeTransitionToHalfOpen();

    if (this.state === "OPEN") {
      this.rejectedCount += 1;
      throw new CircuitBreakerOpenError(this.name);
    }

    const start = this.now();
    try {
      const result = await this.runWithTimeout(fn);
      this.onSuccess(this.now() - start);
      return result;
    } catch (error) {
      this.onFailure(this.now() - start, error);
      throw error;
    }
  }

  /** Forces `CLOSED` regardless of current state — the module's "manual reset" requirement, for operator use (e.g. `/api/health/circuit-breakers` `POST`). */
  reset(): void {
    this.state = "CLOSED";
    this.openedAtMs = null;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
  }

  getSnapshot(): CircuitBreakerSnapshot {
    const totalExecutions = this.successCount + this.failureCount + this.timeoutCount;
    const metrics: CircuitBreakerMetrics = {
      successCount: this.successCount,
      failureCount: this.failureCount,
      timeoutCount: this.timeoutCount,
      rejectedCount: this.rejectedCount,
      recoveryCount: this.recoveryCount,
      totalExecutions,
      averageLatencyMs: totalExecutions > 0 ? round2(this.totalLatencyMs / totalExecutions) : 0,
      lastFailureAt: toIso(this.lastFailureAtMs),
      lastSuccessAt: toIso(this.lastSuccessAtMs),
    };

    return {
      name: this.name,
      state: this.currentState,
      config: this.config,
      metrics,
      openedAt: toIso(this.openedAtMs),
    };
  }

  private async runWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.config.timeoutMs || this.config.timeoutMs <= 0) return fn();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new CircuitBreakerTimeoutError(this.name, this.config.timeoutMs)),
        this.config.timeoutMs,
      );
    });

    try {
      return await Promise.race([fn(), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private maybeTransitionToHalfOpen(): void {
    if (
      this.state === "OPEN" &&
      this.openedAtMs !== null &&
      this.now() - this.openedAtMs >= this.config.resetTimeoutMs
    ) {
      this.state = "HALF_OPEN";
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses = 0;
    }
  }

  private onSuccess(latencyMs: number): void {
    this.successCount += 1;
    this.totalLatencyMs += latencyMs;
    this.lastSuccessAtMs = this.now();
    this.consecutiveFailures = 0;

    if (this.state === "HALF_OPEN") {
      this.consecutiveSuccesses += 1;
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        this.close(true);
      }
    }
  }

  private onFailure(latencyMs: number, error: unknown): void {
    this.totalLatencyMs += latencyMs;
    this.lastFailureAtMs = this.now();
    this.consecutiveSuccesses = 0;

    if (error instanceof CircuitBreakerTimeoutError) {
      this.timeoutCount += 1;
    } else {
      this.failureCount += 1;
    }

    // A trial call failing in HALF_OPEN re-opens immediately — the
    // dependency has not actually recovered, and letting it accumulate a
    // fresh `failureThreshold` count of trial calls first would keep
    // hammering something already known to be broken.
    if (this.state === "HALF_OPEN") {
      this.open();
      return;
    }

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.config.failureThreshold) {
      this.open();
    }
  }

  private open(): void {
    this.state = "OPEN";
    this.openedAtMs = this.now();
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
  }

  private close(fromRecovery: boolean): void {
    this.state = "CLOSED";
    this.openedAtMs = null;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    if (fromRecovery) this.recoveryCount += 1;
  }
}

function toIso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
