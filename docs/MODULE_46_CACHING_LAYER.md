# Module 46 — Caching Layer (Roadmap Module 13)

## 1. Goal

Give the application layer a technology-agnostic caching capability — read-through caching, TTL, namespaces, versioned invalidation, statistics, and health visibility — without ever letting application code depend on Redis directly, and without touching anything Module 44 (Redis Infrastructure) or Module 45 (Background Jobs) already built.

## 2. Architecture

### 2.1 Layering

```
application/ports/
  cache-provider.ts        (CacheProvider interface: get/set/delete/has/deletePattern)
  cache-observer.ts         (CacheObserver interface + nullCacheObserver)

application/services/cache/
  cache-key-builder.ts       (CacheKeyBuilder — deterministic key shape + arg hashing)
  cache-namespace.ts         (CacheNamespace — namespace-bound facade over CacheManager)
  cache-manager.ts           (CacheManager — get/set/delete/has/getOrSet/getStats)
  cache-invalidator.ts        (CacheInvalidator — key/namespace/pattern/version invalidation)
  cache-stats.ts              (CacheStatsCollector — hits/misses/hitRatio/invalidations/errors)

infrastructure/cache/
  in-memory-cache-provider.ts (CacheProvider over a process-local Map)
  redis-cache-provider.ts     (CacheProvider over Module 44's shared RedisClient)
  cache-provider-factory.ts   (chooses Redis vs. in-memory, memoized singleton)
  cache-observability.ts      (CacheObserver backed by logger + Sentry)
  cache-health.ts              (CacheLayerHealthReport shape)
  compose.ts                   (composition root: getCacheManager/getCacheNamespace/getCacheHealth)
```

`application` code (use cases, other services) only ever imports `CacheManager`/`CacheNamespace` from `infrastructure/cache/compose.ts`'s `getCacheManager()`/`getCacheNamespace()`. It never imports `CacheProvider`, `RedisCacheProvider`, or Module 44's `RedisClient`. This mirrors the composition-root split every other cross-cutting module in this codebase uses (`infrastructure/events/compose.ts` for the event bus, `infrastructure/jobs/compose.ts` for background jobs).

### 2.2 Relationship to Module 44's `CacheService`

Module 44 already introduced a narrow `CacheService` port (`get`/`set`/`delete`/`has`) with `InMemoryCacheService`/`RedisCacheService` implementations, consumed today by `CachedGeocodingProvider`. Module 46 does not replace it. `CacheProvider` is a deliberate superset — identical `get`/`set`/`delete`/`has` signatures, plus `deletePattern` (needed for namespace-wide and wildcard invalidation). `RedisCacheProvider` reuses the exact same shared `RedisClient` singleton `RedisCacheService` uses (`redis-client-factory.ts`) — no second Redis connection is opened. Both ports coexist indefinitely: `CacheService` remains the contract for any caller that only ever needs plain get/set/delete/has (unchanged, untouched by this module); `CacheProvider` is what the new orchestration layer (`CacheManager`, `CacheInvalidator`) needs underneath it.

### 2.3 Why a higher-order function, not a decorator

The spec's "cache decorators" requirement is satisfied idiomatically for this codebase rather than literally: `src/core` has no `experimentalDecorators` in `tsconfig.json` and no reflect-metadata/NestJS dependency anywhere. Introducing a class-decorator convention here would be the only one of its kind in the codebase and would fight the existing "plain functions and classes, manual composition" style every other module (`AntiAbuseService`, `SynchronousEventBus`, `Worker`) already follows. `CacheManager.getOrSet()` / `CacheNamespace.getOrSet()` — this module's own "`cache.wrap()`" — is the decorator's functional equivalent: wrap any async call at its call site with try-cache/run-on-miss/store/return, with the identical guarantee a method decorator would give (the wrapped function's own errors are never cached, only its successful result is).

## 3. Cache flow

**Read-through (`getOrSet`)**

1. Caller: `cacheManager.namespace("professionals").getOrSet(["profile", id], ttlMs, () => loadProfile(id))`.
2. `CacheManager` resolves the namespace's current version (`CacheInvalidator.getVersion`) and builds a deterministic key via `CacheKeyBuilder` (`cache:professionals:v3:profile:<id>`).
3. Bypass check: if bypass is active (global config or per-call option), the read is skipped — proceed straight to step 5, but the eventual result is still written (keeps the cache warm for other readers/instances).
4. Cache read: `CacheProvider.get(key)`. Hit → return immediately, recording a hit. Miss (or a provider error, which is treated as a miss, never a thrown error) → continue.
5. Run the caller-supplied loader. If it throws, the exception propagates unchanged and nothing is cached — a failed computation is retried next call, never remembered as if valid.
6. Store the loader's result via `CacheProvider.set(key, value, ttlMs)` and return it.

Every step reports through `CacheObserver` (hit/miss/set/error) and `CacheStatsCollector` (for `getStats()`/the health endpoint).

## 4. Invalidation strategy

Four strategies, all exposed as explicit, application-service-callable hooks off `CacheManager.invalidator` — never a hidden side effect of a write:

- **Single-key** (`invalidateKey`) — removes exactly one entry (e.g. one professional's profile after that profile is edited).
- **Namespace-wide** (`invalidateNamespace` / `CacheNamespace.invalidateAll()`) — implemented as a version bump, not a bulk delete: `CacheKeyBuilder` embeds a `v<N>` segment in every key, so advancing the namespace's stored version makes every previously-built key unreachable instantly and atomically from the very next `build()` call. The old generation is then best-effort bulk-deleted via `deletePattern` (Redis `SCAN`+`DEL`, never blocking `KEYS`) purely to reclaim space promptly; if that bulk delete fails, correctness is unaffected — the old keys simply age out on their own TTL.
- **Wildcard** (`invalidatePattern`) — a raw `*`-glob delete via `CacheProvider.deletePattern`, for callers with a pattern outside the namespace/version shape (e.g. an operator's manual cache-clear tool).
- **Version-based** (`bumpVersion`) — the primitive `invalidateNamespace` is built on top of, also exposed directly for callers that want the new version number itself.

`deletePattern` is the one place a `CacheProvider` implementation is allowed to reach for a bulk mechanism — `RedisCacheProvider` uses a non-blocking `SCAN` cursor loop; `InMemoryCacheProvider` does a single in-process `Map` key iteration.

## 5. Cache keys

`CacheKeyBuilder` is the single place every cache key string is assembled — no call site hand-builds a template string. Shape: `<prefix>:<namespace>:v<version>:<parts...>` (e.g. `cache:professionals:v2:search:madrid:page-1`). `hashArgs()` additionally provides a stable (sorted-keys JSON + FNV-1a hash) key suffix for arbitrary JSON-serializable arguments, so `{a:1,b:2}` and `{b:2,a:1}` produce the same cache entry rather than silently missing each other.

## 6. Bypass, TTL, and serialization

- **Bypass** — `CACHE_BYPASS_ENABLED=true` (env, read by `compose.ts`) or a per-call `{ bypass: true }` option forces every read to miss while still writing results, a debugging/testing switch that never leaves the cache cold for other callers.
- **TTL** — required (not optional) on every `set`, exactly like Module 44's `CacheService` — an unbounded entry is treated as a bug, not a feature.
- **Serialization** — automatic JSON serialize/deserialize in both providers; a malformed stored value is treated as a miss, never thrown, matching `RedisCacheService`'s own established behavior.

## 7. Observability and health

`CacheStatsCollector` tracks hits, misses, hit ratio, sets, deletes, invalidations, and errors per-process (in-memory, same accepted per-instance trade-off `InMemoryRateLimitRepository` already documents). `createCacheObserver()` (infrastructure) reports through the two existing seams every module uses — `logger` (debug for hit/miss/set/delete, info for invalidations) and `createErrorReporter()`/Sentry (warn + exception report on a provider failure, since `CacheManager` always degrades to a safe miss/no-op and a request must never fail because of the cache).

`/api/health/ready` gains `checks.cachingLayer` (`{status, driver, bypass, stats}`), alongside the pre-existing `checks.cache` (Module 44's raw Redis `PING`) and `checks.queue` (Module 45). Like both of those, it is visibility-only — it never changes the endpoint's overall status or HTTP code, because a struggling cache is by design never a reason to stop serving traffic.

## 8. Testing strategy

**Unit** (`tests/unit/core/application/services/cache/`, `tests/unit/core/infrastructure/cache/`): `CacheManager` (get/set/delete/has/getOrSet/bypass/stats), `CacheInvalidator` (key/namespace/pattern/version invalidation), `CacheKeyBuilder` (determinism, sanitization, arg hashing), `CacheNamespace` (facade delegation), `CacheStatsCollector` (counters, hit ratio), `InMemoryCacheProvider` and `RedisCacheProvider` (get/set/delete/has/deletePattern, TTL expiry, serialization), `cache-provider-factory` (Redis vs. in-memory selection, memoization), `cache-observability` (logger/Sentry wiring), `compose` (singleton behavior, env wiring).

**Integration** (`tests/integration/cache/cache-flows.test.ts`, `tests/integration/observability/health-routes.test.ts`): full `CacheManager → CacheProvider → real Redis wire protocol` flows against the same in-process fake Redis server Module 44's own integration tests use — read-through caching, namespace-wide invalidation via version bump, cross-namespace isolation, wildcard invalidation, bypass behavior, and the `/api/health/ready` caching-layer check (including the `bypassed` state).

No existing test was modified to weaken an assertion; `fake-redis-server.ts` gained `SCAN` support and multi-key `DEL` (both real Redis capabilities the fake didn't need to model before this module) additively, and `env-fixture.ts` gained the two new env keys so existing env-dependent tests keep resetting state correctly.

## 9. Performance considerations

- **No new Redis connection.** `RedisCacheProvider` reuses Module 44's shared `RedisClient` singleton — no additional connection pool, no extra TLS handshake.
- **Non-blocking bulk deletes.** `deletePattern` uses `SCAN` (cursor-based, small batches), never `KEYS`, which would block the single-threaded Redis server for the duration of a full keyspace scan.
- **Version-bump invalidation is O(1), not O(namespace size).** Namespace-wide invalidation never needs to enumerate or delete every key synchronously — the version bump alone makes the old generation unreachable; bulk deletion of the old generation is best-effort and off the critical path of the invalidating call.
- **Bypass is additive, not destructive.** Bypassing reads still writes fresh results, so the cache stays warm for every other reader/instance instead of being fully invalidated by a debugging session.
- **In-memory fallback has zero network cost** when `REDIS_URL` is unset, at the cost of being per-process (not shared across instances) — the same accepted trade-off Module 44's `InMemoryCacheService` already documents.

## 10. What did not change

Module 44's `CacheService`/`InMemoryCacheService`/`RedisCacheService`/`cache-service-factory.ts` and their consumers (`CachedGeocodingProvider`), Module 44's `RedisClient`/`redis-client-factory.ts`/`redis-protocol.ts`, Module 45's job infrastructure, the existing `/api/health/ready` response shape for `database`/`cache`/`queue`, and every pre-existing test's assertions.
