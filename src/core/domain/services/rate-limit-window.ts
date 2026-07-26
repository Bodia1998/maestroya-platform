/**
 * Security & Anti-Abuse module (Module 24): pure fixed-window rate-limit
 * math, dependency-free and unit-testable without a database — same small-
 * helper style as money.ts/geo-distance.ts. `InMemoryRateLimitRepository`
 * (infrastructure) is the only caller today, but any future
 * `RateLimitRepository` implementation (e.g. Redis-backed) can reuse this
 * for a consistent window/retryAfter calculation.
 *
 * Fixed-window (not sliding-window/token-bucket) is a deliberate, simple
 * choice: it allows a short burst right at a window boundary (worst case,
 * ~2x the configured limit across the boundary), which is an accepted
 * trade-off for how small/cheap it is to reason about and test. A sliding
 * window or token bucket would be a strict improvement but is not needed
 * for this module's actual threat model (see docs/MODULE_24_SECURITY_ANTI_ABUSE.md).
 */
export interface RateLimitWindowState {
  /** Epoch ms marking the start of the current fixed window. */
  windowStart: number;
  /** Number of attempts recorded within [windowStart, windowStart + windowMs). */
  count: number;
}

export interface RateLimitComputation {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number | null;
  nextState: RateLimitWindowState;
}

/**
 * Given the previous window state (or undefined for a key never seen
 * before) and "now", decides whether this attempt is allowed under
 * `limit` per `windowMs`, and returns the state to persist.
 *
 * `now` is always passed in (never read internally via `Date.now()`) so
 * this stays deterministic and trivially testable with fixed timestamps.
 */
export function computeRateLimit(
  previous: RateLimitWindowState | undefined,
  limit: number,
  windowMs: number,
  now: number,
): RateLimitComputation {
  if (limit <= 0) {
    throw new RangeError("Rate limit policy `limit` must be a positive integer.");
  }
  if (windowMs <= 0) {
    throw new RangeError("Rate limit policy `windowMs` must be a positive integer.");
  }

  const windowExpired = !previous || now - previous.windowStart >= windowMs;
  const windowStart = windowExpired ? now : previous!.windowStart;
  const countBeforeThisAttempt = windowExpired ? 0 : previous!.count;

  if (countBeforeThisAttempt >= limit) {
    const retryAfterMs = windowStart + windowMs - now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(retryAfterMs, 0),
      nextState: { windowStart, count: countBeforeThisAttempt },
    };
  }

  const count = countBeforeThisAttempt + 1;
  return {
    allowed: true,
    remaining: Math.max(limit - count, 0),
    retryAfterMs: null,
    nextState: { windowStart, count },
  };
}
