/**
 * Module 56 — Health Checks & Circuit Breakers.
 *
 * The three states of a single circuit breaker, following the standard
 * pattern (Fowler/Nygard's "Release It!"):
 *
 * - `CLOSED` — normal operation. Calls pass through; consecutive
 *   failures are counted, and `failureThreshold` of them in a row trips
 *   the breaker to `OPEN`.
 * - `OPEN` — calls are rejected immediately (`CircuitBreakerOpenError`),
 *   without ever invoking the wrapped function — the entire point being
 *   to stop hammering a dependency that has already demonstrated it is
 *   unavailable. After `resetTimeoutMs` has elapsed since opening, the
 *   next call is allowed through as a single trial and the breaker moves
 *   to `HALF_OPEN`.
 * - `HALF_OPEN` — a limited number of trial calls are allowed through.
 *   `successThreshold` consecutive successes closes the breaker again; a
 *   single failure re-opens it immediately (a still-broken dependency
 *   must not get another full `failureThreshold` count of trial calls).
 */
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  /** Consecutive failures, from `CLOSED`, before the breaker trips to `OPEN`. */
  readonly failureThreshold: number;
  /** Consecutive successes, from `HALF_OPEN`, before the breaker closes. */
  readonly successThreshold: number;
  /** Per-execution timeout, in milliseconds. A call that does not settle within this is treated as a failure. `0` disables the timeout. */
  readonly timeoutMs: number;
  /** How long, in milliseconds, the breaker stays `OPEN` before allowing a `HALF_OPEN` trial call. */
  readonly resetTimeoutMs: number;
}

/**
 * Safe, conservative defaults — deliberately generic (not tuned to any
 * one dependency), since every named breaker in
 * `infrastructure/health/compose.ts` can override any field. Chosen so a
 * breaker constructed with no configuration at all still behaves
 * sensibly rather than tripping on the very first blip or never
 * recovering.
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeoutMs: 5000,
  resetTimeoutMs: 30_000,
};

/** Cumulative execution metrics a single breaker instance has recorded since process start (or its last `reset()`/construction). */
export interface CircuitBreakerMetrics {
  readonly successCount: number;
  readonly failureCount: number;
  readonly timeoutCount: number;
  /** Calls rejected outright because the breaker was `OPEN` — never reached the wrapped function. */
  readonly rejectedCount: number;
  /** Number of times the breaker has transitioned `HALF_OPEN` → `CLOSED` (a completed automatic recovery). */
  readonly recoveryCount: number;
  /** `successCount + failureCount + timeoutCount` — excludes `rejectedCount`, which never executed anything to measure. */
  readonly totalExecutions: number;
  /** Mean wall-clock duration, in milliseconds, of every executed (non-rejected) call. */
  readonly averageLatencyMs: number;
  readonly lastFailureAt: string | null;
  readonly lastSuccessAt: string | null;
}

/** The full, serializable state of one breaker — what `/api/health/circuit-breakers` reports per dependency. */
export interface CircuitBreakerSnapshot {
  readonly name: string;
  readonly state: CircuitState;
  readonly config: CircuitBreakerConfig;
  readonly metrics: CircuitBreakerMetrics;
  /** When the breaker most recently transitioned to `OPEN`. `null` if it never has, or has since been manually reset. */
  readonly openedAt: string | null;
}
