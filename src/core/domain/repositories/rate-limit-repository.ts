/**
 * Security & Anti-Abuse module (Module 24): reusable rate-limiting
 * abstraction used by AntiAbuseService (application layer) to answer
 * "has this key already used up its budget for this window".
 *
 * Deliberately generic (a key, a limit, a window, "how many so far") so
 * the exact same interface backs login attempts, registration, password
 * reset requests, service-request/quote/message/review creation, etc. —
 * only the policy (limit/window) and the key-building logic differ per
 * operation (see application/ports/rate-limit-policies.ts and
 * domain/services/security-key.ts).
 *
 * `InMemoryRateLimitRepository` (infrastructure/security) is the only
 * implementation wired up today — this codebase is single-instance and has
 * no Redis/cache layer yet (see package.json: no redis/ioredis dependency).
 * That is a real limitation for a multi-instance deployment (see
 * docs/MODULE_24_SECURITY_ANTI_ABUSE.md, "Deferred to Module 25") — this
 * interface is shaped so a future Redis-backed implementation (INCR + PEXPIRE,
 * or a Lua sliding-window script) can be dropped in via the same
 * composition root without touching any caller.
 */
export interface RateLimitDecision {
  /** Whether this attempt is allowed to proceed. */
  allowed: boolean;
  /** The configured limit for this key's policy — safe to log, never
   *  surfaced verbatim to an end user (see RateLimitedError). */
  limit: number;
  /** How many requests remain in the current window after this attempt
   *  (0 when blocked). */
  remaining: number;
  /** Milliseconds until the caller may retry, or `null` when `allowed` is
   *  true. */
  retryAfterMs: number | null;
}

export interface RateLimitRepository {
  /**
   * Atomically records one attempt against `key` and returns whether it
   * is within `limit` for a fixed window of `windowMs` milliseconds
   * anchored at `now`. Implementations must be safe under concurrent
   * calls for the same key (see InMemoryRateLimitRepository's own doc
   * comment on why a plain Map + read-modify-write is *not* safe under
   * true parallelism, and why that's an accepted single-instance
   * limitation here).
   */
  consume(key: string, limit: number, windowMs: number, now: Date): Promise<RateLimitDecision>;

  /** Test/admin-utility only: clears any stored state for `key`. Never
   *  called from a Server Action/API route reachable by a client. */
  reset(key: string): Promise<void>;
}
