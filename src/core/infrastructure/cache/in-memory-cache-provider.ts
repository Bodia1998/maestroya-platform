import "server-only";

import type { CacheProvider } from "@/application/ports/cache-provider";

/**
 * Module 46 — Caching Layer (Roadmap Module 13).
 *
 * Single-process `CacheProvider` backed by a plain `Map`, same shape and
 * trade-offs as Module 44's `InMemoryCacheService` (lazy expiry
 * reclamation on next access, cleared on process restart, never a
 * correctness problem — only a missed optimization). Kept as a distinct
 * class rather than reusing `InMemoryCacheService` directly because
 * `CacheProvider` additionally needs `deletePattern`, which requires
 * iterating this map's own keys — a capability `InMemoryCacheService`
 * deliberately does not expose (its contract is intentionally narrower;
 * see that class's own doc comment). The default `CacheProvider` for any
 * environment without `REDIS_URL` configured — see `cache-provider-factory.ts`.
 */
interface Entry {
  value: unknown;
  expiresAt: number;
}

export class InMemoryCacheProvider implements CacheProvider {
  private readonly store = new Map<string, Entry>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    if (ttlMs <= 0) {
      throw new RangeError("CacheProvider.set: ttlMs must be a positive integer.");
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  /**
   * `pattern` is a `*`-glob (the same shape `RedisCacheProvider.deletePattern`
   * accepts) — translated to a `RegExp` for a single pass over this
   * process's own key set. Never a performance concern at this cache's
   * scope: a single-process `Map` iteration, not a network round trip.
   */
  async deletePattern(pattern: string): Promise<number> {
    const regex = globToRegExp(pattern);
    let removed = 0;
    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  /** Exposed for tests only. */
  size(): number {
    return this.store.size;
  }
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}
