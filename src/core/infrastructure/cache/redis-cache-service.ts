import "server-only";

import type { CacheService } from "@/application/ports/cache-service";
import type { RedisClient } from "@/infrastructure/cache/redis-client";

/**
 * Module 44 — Redis Infrastructure (Roadmap Module 11).
 *
 * `CacheService` backed by a shared Redis instance — the multi-instance-
 * safe counterpart to `InMemoryCacheService`. Values are JSON-serialized
 * on `set` and parsed back on `get`, so callers work with typed values
 * (`T`), never raw Redis strings, matching the port's contract.
 *
 * `SET key value PX ttlMs` is a single atomic command (no separate
 * `EXPIRE` call, no window where a value briefly exists without its
 * TTL), avoiding the exact class of race the security module's own doc
 * comments call out for the in-memory rate limiter's read-modify-write.
 *
 * A malformed stored value (e.g. from a future format change, or a key
 * someone else wrote to the same Redis instance/DB) is treated as a
 * cache miss (`null`) rather than throwing — a cache is never allowed to
 * be the reason a request fails; the caller falls through to its own
 * "not cached" path exactly as on a real miss.
 */
export class RedisCacheService implements CacheService {
  constructor(private readonly client: RedisClient) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.command(["GET", key]);
    if (raw === null || typeof raw !== "string") return null;

    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    if (ttlMs <= 0) {
      throw new RangeError("CacheService.set: ttlMs must be a positive integer.");
    }
    const serialized = JSON.stringify(value);
    await this.client.command(["SET", key, serialized, "PX", ttlMs]);
  }

  async delete(key: string): Promise<void> {
    await this.client.command(["DEL", key]);
  }

  async has(key: string): Promise<boolean> {
    const result = await this.client.command(["EXISTS", key]);
    return result === 1;
  }
}
