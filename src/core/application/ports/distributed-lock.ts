/**
 * Module 44 — Redis Infrastructure (Roadmap Module 11).
 *
 * A minimal mutual-exclusion primitive for "at most one instance of this
 * process/cluster should run this operation at a time" — the
 * distributed-locking counterpart to `CacheService` and
 * `RateLimitRepository`. Same "application/ports" convention (a
 * cross-cutting technical capability, not tied to a domain entity).
 *
 * Deliberately shaped as a single `withLock` helper rather than exposing
 * separate `acquire`/`release` calls — that shape makes "forgot to
 * release the lock" structurally impossible (a `try/finally` inside the
 * implementation guarantees release, including on the protected
 * function throwing), which matters more for a lock than almost any
 * other primitive: a leaked lock silently blocks every future
 * acquisition until its TTL expires.
 *
 * No caller in this codebase's existing modules currently *requires*
 * distributed locking (the workflow-expiration cron route
 * — `src/app/api/cron/expire-workflows/route.ts` — is naturally
 * idempotent today: re-running it twice concurrently just does the same
 * DB updates twice, no double-effect), so this module does not force a
 * lock onto that route. It is provided as ready, tested infrastructure
 * for the next use case that does need it (e.g. a future background job
 * that must not run twice concurrently across instances) — exactly the
 * same "ready, validated seam, not force-adopted everywhere" posture
 * Module 25 took with `REDIS_URL` itself.
 */
export interface DistributedLock {
  /**
   * Attempts to acquire `key` for up to `ttlMs` milliseconds, runs `fn`
   * if acquired, and always releases the lock afterward (success or
   * throw) before this function's own promise settles. Returns `null`
   * without calling `fn` if the lock is already held by someone else —
   * callers decide what "couldn't acquire" means for their own flow
   * (skip, retry, error) rather than this interface imposing a policy.
   *
   * `ttlMs` is a safety net, not a scheduling mechanism: if the holder
   * crashes or is killed mid-operation, the lock self-expires after
   * `ttlMs` rather than blocking every future attempt forever. Callers
   * should choose `ttlMs` comfortably longer than `fn`'s expected
   * duration.
   */
  withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null>;
}
