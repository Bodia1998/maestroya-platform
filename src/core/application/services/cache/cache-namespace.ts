import type { CacheManager, GetOrSetOptions } from "@/application/services/cache/cache-manager";

/**
 * Module 46 — Caching Layer (Roadmap Module 13).
 *
 * A thin, namespace-bound facade over `CacheManager` — the ergonomic
 * shape an application service actually wants at a call site (`const
 * professionalsCache = cacheManager.namespace("professionals"); await
 * professionalsCache.getOrSet(["search", city], ttl, loader);`) instead
 * of repeating the namespace string as the first argument to every call.
 * Holds no state of its own beyond the namespace name — every operation
 * still goes through the owning `CacheManager`, so namespace-wide
 * invalidation, versioning, and statistics all stay centralized there.
 */
export class CacheNamespace {
  constructor(
    private readonly manager: CacheManager,
    readonly name: string,
  ) {}

  get<T>(parts: ReadonlyArray<string | number>, options?: GetOrSetOptions): Promise<T | null> {
    return this.manager.get<T>(this.name, parts, options);
  }

  set<T>(parts: ReadonlyArray<string | number>, value: T, ttlMs: number): Promise<void> {
    return this.manager.set<T>(this.name, parts, value, ttlMs);
  }

  delete(parts: ReadonlyArray<string | number>): Promise<void> {
    return this.manager.delete(this.name, parts);
  }

  has(parts: ReadonlyArray<string | number>): Promise<boolean> {
    return this.manager.has(this.name, parts);
  }

  getOrSet<T>(
    parts: ReadonlyArray<string | number>,
    ttlMs: number,
    loader: () => Promise<T>,
    options?: GetOrSetOptions,
  ): Promise<T> {
    return this.manager.getOrSet<T>(this.name, parts, ttlMs, loader, options);
  }

  /** Invalidates every key currently cached under this namespace. */
  invalidateAll(): Promise<number> {
    return this.manager.invalidator.invalidateNamespace(this.name);
  }
}
