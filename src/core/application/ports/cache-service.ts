/**
 * Module 44 — Redis Infrastructure (Roadmap Module 11).
 *
 * Generic, technology-agnostic key/value cache abstraction — same
 * "application/ports" convention as `error-reporter.ts` and
 * `event-bus.ts` (a cross-cutting technical capability, not tied to one
 * domain entity, consumed by application/infrastructure code without
 * committing callers to a specific backend).
 *
 * Two implementations exist: `InMemoryCacheService` (single-process
 * `Map`, always available, zero configuration) and `RedisCacheService`
 * (shared across instances, used automatically once `REDIS_URL` is
 * configured — see `cache-service-factory.ts`). Both are drop-in
 * replacements for each other; no caller should ever import either
 * implementation directly — always go through `createCacheService()`.
 *
 * Deliberately does not expose Redis-specific concepts (pub/sub, streams,
 * sorted sets, etc.) — this is a cache, not a general Redis client
 * escape hatch. A future module with a genuine need for a different
 * Redis capability should extend this port narrowly (as this module did
 * for locking — see `distributed-lock.ts`, a sibling port) rather than
 * widening this one into a grab-bag.
 */
export interface CacheService {
  /**
   * Returns the cached value for `key`, or `null` on a miss (key absent
   * or expired). Values are stored/retrieved as their JSON-serialized
   * form under the hood — callers get back a value of the same shape
   * they stored, not a raw string.
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Stores `value` under `key`, expiring after `ttlMs` milliseconds.
   * `ttlMs` is required (not optional) — an unbounded cache entry is
   * almost always a bug (a slowly-growing memory leak in
   * `InMemoryCacheService`, or a stale value that never refreshes in
   * `RedisCacheService`); callers must make an explicit, deliberate TTL
   * choice, the same discipline `CachedGeocodingProvider` already
   * applies with its own `DEFAULT_TTL_MS`.
   */
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;

  /** Removes `key` if present. A no-op (not an error) if already absent. */
  delete(key: string): Promise<void>;

  /** Whether `key` is currently present and unexpired. */
  has(key: string): Promise<boolean>;
}
