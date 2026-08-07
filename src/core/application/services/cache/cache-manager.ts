import type { CacheProvider } from "@/application/ports/cache-provider";
import { nullCacheObserver, type CacheObserver } from "@/application/ports/cache-observer";
import { CacheInvalidator } from "@/application/services/cache/cache-invalidator";
import { CacheKeyBuilder, type CacheKeyBuilderOptions } from "@/application/services/cache/cache-key-builder";
import { CacheNamespace } from "@/application/services/cache/cache-namespace";
import { CacheStatsCollector, type CacheStatsSnapshot } from "@/application/services/cache/cache-stats";

/**
 * Module 46 — Caching Layer (Roadmap Module 13).
 *
 * The single entry point application code uses for caching — depends
 * only on the `CacheProvider` port (never Redis, never any concrete
 * backend directly), matching every other application-layer
 * orchestrator in this codebase (`AntiAbuseService` depends only on
 * repository interfaces; `CacheManager` depends only on `CacheProvider`
 * and `CacheObserver`). `infrastructure/cache/compose.ts` is the one
 * place that decides which concrete `CacheProvider` a given process gets
 * and wires it in here — exactly the same composition-root split Module
 * 45 uses for `Queue`/`Worker` vs. `infrastructure/jobs/compose.ts`.
 *
 * Orchestrates:
 *  - **Key building** — every `get`/`set`/`delete`/`has` call goes
 *    through `CacheKeyBuilder`, never a hand-built template string.
 *  - **Namespacing & versioning** — every operation is scoped to a
 *    `namespace` and automatically reads that namespace's current
 *    version before building the key (see `CacheInvalidator.getVersion`),
 *    so a version bump invalidates the whole namespace with no explicit
 *    per-key deletion.
 *  - **Invalidation** — exposed as `manager.invalidator` (see
 *    `cache-invalidator.ts`), the explicit hook application services call
 *    after a write that makes cached data stale.
 *  - **Read-through caching** — `getOrSet()` ("`cache.wrap()`" in the
 *    module's own vocabulary): try the cache, run the supplied loader on
 *    a miss, store its result, return it. This codebase is plain
 *    Next.js/Express-style server code with no decorator/reflect-metadata
 *    convention anywhere in `src/core` (checked: no `experimentalDecorators`
 *    in `tsconfig.json`, no NestJS dependency) — a higher-order function
 *    is therefore the idiom that actually fits, not a class decorator
 *    that would be the only one of its kind in the codebase.
 *  - **Bypass** — a config flag (`infrastructure/cache/compose.ts` reads
 *    `CACHE_BYPASS_ENABLED`) or an explicit per-call `{ bypass: true }`
 *    option skips the cache *read* for debugging/testing while still
 *    writing the freshly-computed value, so the very next call benefits
 *    from a warm cache again.
 *  - **Statistics** — `getStats()` exposes hits/misses/hit ratio/
 *    invalidations (see `cache-stats.ts`), read by
 *    `infrastructure/cache/cache-health.ts` for the health endpoint.
 */
export interface CacheManagerOptions {
  keyBuilder?: CacheKeyBuilderOptions;
  observer?: CacheObserver;
  /**
   * When `true` (or a function that returns `true` at call time), every
   * `get`/`getOrSet` treats the cache as empty — the loader always runs.
   * Values are still written on `set`/`getOrSet`, so bypass is a "always
   * refetch, keep the cache warm for everyone else" debugging switch, not
   * a full cache disable.
   */
  bypass?: boolean | (() => boolean);
}

export interface GetOrSetOptions {
  /** Overrides the manager-level bypass decision for this one call. */
  bypass?: boolean;
}

export class CacheManager {
  readonly invalidator: CacheInvalidator;
  private readonly keys: CacheKeyBuilder;
  private readonly observer: CacheObserver;
  private readonly stats = new CacheStatsCollector();
  private readonly bypassOption: boolean | (() => boolean);

  constructor(
    private readonly provider: CacheProvider,
    options: CacheManagerOptions = {},
  ) {
    this.keys = new CacheKeyBuilder(options.keyBuilder);
    this.observer = options.observer ?? nullCacheObserver;
    this.bypassOption = options.bypass ?? false;
    this.invalidator = new CacheInvalidator(provider, this.keys, this.observer, this.stats);
  }

  /** A convenience facade scoped to one namespace — see `CacheNamespace`. */
  namespace(name: string): CacheNamespace {
    return new CacheNamespace(this, name);
  }

  async get<T>(namespace: string, parts: ReadonlyArray<string | number>, options: GetOrSetOptions = {}): Promise<T | null> {
    if (this.isBypassed(options)) {
      this.observer.onMiss({ namespace, key: await this.buildKey(namespace, parts) });
      this.stats.recordMiss();
      return null;
    }

    const key = await this.buildKey(namespace, parts);
    try {
      const value = await this.provider.get<T>(key);
      if (value === null) {
        this.observer.onMiss({ namespace, key });
        this.stats.recordMiss();
        return null;
      }
      this.observer.onHit({ namespace, key });
      this.stats.recordHit();
      return value;
    } catch (error) {
      this.observer.onError({ operation: "get", namespace, key, error });
      this.stats.recordError();
      return null;
    }
  }

  async set<T>(namespace: string, parts: ReadonlyArray<string | number>, value: T, ttlMs: number): Promise<void> {
    const key = await this.buildKey(namespace, parts);
    try {
      await this.provider.set(key, value, ttlMs);
      this.observer.onSet({ namespace, key, ttlMs });
      this.stats.recordSet();
    } catch (error) {
      this.observer.onError({ operation: "set", namespace, key, error });
      this.stats.recordError();
      throw error;
    }
  }

  async delete(namespace: string, parts: ReadonlyArray<string | number>): Promise<void> {
    const key = await this.buildKey(namespace, parts);
    try {
      await this.provider.delete(key);
      this.observer.onDelete({ namespace, key });
      this.stats.recordDelete();
    } catch (error) {
      this.observer.onError({ operation: "delete", namespace, key, error });
      this.stats.recordError();
      throw error;
    }
  }

  async has(namespace: string, parts: ReadonlyArray<string | number>): Promise<boolean> {
    const key = await this.buildKey(namespace, parts);
    try {
      return await this.provider.has(key);
    } catch (error) {
      this.observer.onError({ operation: "has", namespace, key, error });
      this.stats.recordError();
      return false;
    }
  }

  /**
   * Read-through caching ("`cache.wrap()`"): returns the cached value for
   * `namespace`/`parts` if present; otherwise calls `loader()`, stores
   * its result under `ttlMs`, and returns it. `loader`'s own errors
   * propagate to the caller unchanged and are never cached — a failed
   * computation must be retried on the next call, not remembered as if
   * it were a valid result.
   */
  async getOrSet<T>(
    namespace: string,
    parts: ReadonlyArray<string | number>,
    ttlMs: number,
    loader: () => Promise<T>,
    options: GetOrSetOptions = {},
  ): Promise<T> {
    if (!this.isBypassed(options)) {
      const cached = await this.get<T>(namespace, parts, options);
      if (cached !== null) return cached;
    } else {
      this.observer.onMiss({ namespace, key: await this.buildKey(namespace, parts) });
      this.stats.recordMiss();
    }

    const value = await loader();
    await this.set(namespace, parts, value, ttlMs);
    return value;
  }

  getStats(): CacheStatsSnapshot {
    return this.stats.snapshot();
  }

  private isBypassed(options: GetOrSetOptions): boolean {
    if (options.bypass !== undefined) return options.bypass;
    return typeof this.bypassOption === "function" ? this.bypassOption() : this.bypassOption;
  }

  private async buildKey(namespace: string, parts: ReadonlyArray<string | number>): Promise<string> {
    const version = await this.invalidator.getVersion(namespace);
    return this.keys.build(namespace, version, parts);
  }
}
