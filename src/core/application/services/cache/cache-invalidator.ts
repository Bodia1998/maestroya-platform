import type { CacheProvider } from "@/application/ports/cache-provider";
import { nullCacheObserver, type CacheObserver } from "@/application/ports/cache-observer";
import { CacheKeyBuilder } from "@/application/services/cache/cache-key-builder";
import { CacheStatsCollector } from "@/application/services/cache/cache-stats";

/**
 * Module 46 — Caching Layer (Roadmap Module 13).
 *
 * Every invalidation strategy the module's spec asks for, in one place:
 *
 *  - **Single-key** (`invalidateKey`) — removes exactly one entry.
 *  - **Namespace-wide** (`invalidateNamespace`) — implemented as a
 *    version bump (see `CacheKeyBuilder`'s own doc comment): the
 *    namespace's entire current generation of keys becomes unreachable
 *    instantly and atomically from the very next `build()` call, with a
 *    best-effort bulk delete of the old generation via `deletePattern`
 *    for backends that support it, purely to reclaim space promptly
 *    rather than waiting on individual TTL expiry.
 *  - **Wildcard** (`invalidatePattern`) — a raw `*`-glob delete via the
 *    provider's `deletePattern` (Redis `SCAN`+`DEL`, or a `Map` prefix
 *    filter for `InMemoryCacheProvider`), for callers with a pattern
 *    outside the namespace/version shape (e.g. an operator's manual
 *    cache-clear tool).
 *  - **Version-based** (`bumpVersion`) — the primitive `invalidateNamespace`
 *    is built on, also exposed directly for callers that want the new
 *    version number itself (e.g. to log it).
 *
 * `CacheManager` exposes all of these as `manager.invalidator.*` —
 * explicit, application-service-callable hooks (e.g. "a professional's
 * profile was updated, so call
 * `cacheManager.invalidator.invalidateNamespace('professionals')`"),
 * never a hidden side effect of a write.
 */

/** How long a namespace's version counter is retained for. ~1 year — long
 *  enough that it is for all practical purposes "until explicitly bumped
 *  again", while still satisfying `CacheProvider.set`'s required,
 *  positive `ttlMs` (an unbounded entry is not offered by the contract
 *  this class is built on — see `cache-provider.ts`). */
const VERSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export class CacheInvalidator {
  constructor(
    private readonly provider: CacheProvider,
    private readonly keys: CacheKeyBuilder = new CacheKeyBuilder(),
    private readonly observer: CacheObserver = nullCacheObserver,
    private readonly stats: CacheStatsCollector = new CacheStatsCollector(),
  ) {}

  /** The namespace's current version, defaulting to `1` if never bumped. */
  async getVersion(namespace: string): Promise<number> {
    try {
      const stored = await this.provider.get<number>(this.keys.versionKey(namespace));
      return stored ?? 1;
    } catch (error) {
      this.observer.onError({ operation: "get", namespace, error });
      this.stats.recordError();
      return 1;
    }
  }

  /**
   * Advances `namespace`'s version, making every key built under the
   * previous version unreachable, then best-effort bulk-deletes that
   * previous generation. Returns the new version number.
   */
  async bumpVersion(namespace: string): Promise<number> {
    const current = await this.getVersion(namespace);
    const next = current + 1;

    try {
      await this.provider.set(this.keys.versionKey(namespace), next, VERSION_TTL_MS);
    } catch (error) {
      this.observer.onError({ operation: "set", namespace, error });
      this.stats.recordError();
      throw error;
    }

    const pattern = this.keys.namespacePattern(namespace, current);
    const removed = await this.safeDeletePattern(namespace, pattern);
    this.observer.onInvalidate({ namespace, scope: "version", target: pattern, count: removed });
    this.stats.recordInvalidation(removed);

    return next;
  }

  /** Namespace-wide invalidation — see the class doc comment. */
  async invalidateNamespace(namespace: string): Promise<number> {
    return this.bumpVersion(namespace);
  }

  /** Removes exactly one key. */
  async invalidateKey(namespace: string, version: number, parts: ReadonlyArray<string | number>): Promise<void> {
    const key = this.keys.build(namespace, version, parts);
    try {
      await this.provider.delete(key);
    } catch (error) {
      this.observer.onError({ operation: "delete", namespace, key, error });
      this.stats.recordError();
      throw error;
    }
    this.observer.onInvalidate({ namespace, scope: "key", target: key, count: 1 });
    this.stats.recordInvalidation(1);
  }

  /** Removes every key matching a raw `*`-glob pattern. */
  async invalidatePattern(pattern: string, namespace = "*"): Promise<number> {
    const removed = await this.safeDeletePattern(namespace, pattern);
    this.observer.onInvalidate({ namespace, scope: "pattern", target: pattern, count: removed });
    this.stats.recordInvalidation(removed);
    return removed;
  }

  private async safeDeletePattern(namespace: string, pattern: string): Promise<number> {
    try {
      return await this.provider.deletePattern(pattern);
    } catch (error) {
      this.observer.onError({ operation: "deletePattern", namespace, error });
      this.stats.recordError();
      return 0;
    }
  }
}
