import "server-only";

import type { CacheService } from "@/application/ports/cache-service";

/**
 * Module 44 — Redis Infrastructure (Roadmap Module 11).
 *
 * Single-process, TTL-based `CacheService` backed by a plain `Map` — same
 * shape and trade-offs as the pre-existing `CachedGeocodingProvider`
 * decorator (infrastructure/geocoding), generalized into a standalone,
 * reusable service rather than a one-off decorator. Left as the
 * *default* `CacheService` (see `cache-service-factory.ts`) for any
 * environment without `REDIS_URL` configured — local dev, most CI runs,
 * and any single-instance deployment where a shared cache isn't yet
 * needed. Not shared across instances/processes; a cache miss here is
 * never a correctness problem, only a missed optimization (falls through
 * to whatever the caller does on a miss).
 *
 * Expired entries are only reclaimed lazily, on their own next access —
 * same accepted trade-off `InMemoryRateLimitRepository` documents for its
 * own bucket map — bounded in practice by this cache's actual key space
 * (whatever a caller chooses to cache), and cleared entirely on process
 * restart.
 */
interface Entry {
  value: unknown;
  expiresAt: number;
}

export class InMemoryCacheService implements CacheService {
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
      throw new RangeError("CacheService.set: ttlMs must be a positive integer.");
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  /** Exposed for tests only. */
  size(): number {
    return this.store.size;
  }
}
