/**
 * Module 46 — Caching Layer (Roadmap Module 13).
 *
 * The low-level, technology-agnostic storage seam the caching layer's
 * orchestration code (`CacheManager`, `CacheNamespace`, `CacheInvalidator`
 * — application/services/cache/) is built on top of. Same
 * "application/ports" convention as Module 44's own `cache-service.ts`:
 * a cross-cutting technical capability, consumed without ever committing
 * a caller to a specific backend.
 *
 * `CacheProvider` is deliberately a superset of Module 44's
 * `CacheService` (get/set/delete/has, identical signatures — a
 * `CacheService` is trivially a `CacheProvider` once `deletePattern` is
 * added), not a competing abstraction: `RedisCacheProvider` reuses the
 * exact same shared `RedisClient` singleton `RedisCacheService` does (see
 * `redis-client-factory.ts`), and both `CacheService` and `CacheProvider`
 * are free to coexist indefinitely — `CacheService` remains the contract
 * for any existing/future caller that only ever needs plain get/set/
 * delete/has, `CacheProvider` is what the new caching layer's
 * higher-level features (namespace-wide invalidation, wildcard
 * invalidation) need underneath them.
 *
 * `deletePattern` is the one genuinely new capability: bulk-removing
 * every key matching a glob-style pattern (`prefix:namespace:*`),
 * needed for namespace-wide and wildcard invalidation. It is
 * intentionally the *only* place a `CacheProvider` implementation is
 * allowed to reach for a backend-specific bulk mechanism (Redis
 * `SCAN`+`DEL`, or a plain `Map` prefix filter for the in-memory
 * implementation) — everything else stays a single-key operation.
 */
export interface CacheProvider {
  /**
   * Returns the cached value for `key`, or `null` on a miss (absent,
   * expired, or a value that fails to deserialize — a cache is never
   * allowed to be the reason a request fails, exactly like Module 44's
   * `CacheService.get`).
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Stores `value` under `key`, expiring after `ttlMs` milliseconds.
   * `ttlMs` is required, not optional, for the identical reason Module
   * 44's `CacheService.set` requires it — an unbounded entry is almost
   * always a bug.
   */
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;

  /** Removes `key` if present. A no-op (not an error) if already absent. */
  delete(key: string): Promise<void>;

  /** Whether `key` is currently present and unexpired. */
  has(key: string): Promise<boolean>;

  /**
   * Removes every key matching `pattern` (a `*`-glob, e.g.
   * `"cache:professionals:v3:*"`). Returns the number of keys removed —
   * callers (`CacheInvalidator`) use this for observability (the
   * "invalidation count" the module's spec asks for), not for control
   * flow. Must never throw for "no keys matched" (returns `0`), only for
   * a genuine backend failure.
   */
  deletePattern(pattern: string): Promise<number>;
}
