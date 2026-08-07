import "server-only";

import type { CacheService } from "@/application/ports/cache-service";
import { InMemoryCacheService } from "@/infrastructure/cache/in-memory-cache-service";
import { RedisCacheService } from "@/infrastructure/cache/redis-cache-service";
import { getRedisClient } from "@/infrastructure/cache/redis-client-factory";

/**
 * Module 44 — Redis Infrastructure (Roadmap Module 11).
 *
 * The single place that decides which `CacheService` implementation a
 * given process gets — same factory-function shape as
 * `error-reporter-factory.ts` (Module 39) and
 * `geocoding-provider-factory.ts` (Module 27): `RedisCacheService` when
 * `REDIS_URL` is configured, `InMemoryCacheService` otherwise. A single
 * memoized instance per process, so every composition root that calls
 * this shares one cache rather than each holding its own.
 */
let instance: CacheService | null = null;

export function createCacheService(): CacheService {
  if (!instance) {
    const redisClient = getRedisClient();
    instance = redisClient ? new RedisCacheService(redisClient) : new InMemoryCacheService();
  }
  return instance;
}

/** Exposed for tests only — forces the next call to re-decide. */
export const __testing = {
  reset(): void {
    instance = null;
  },
};
