import "server-only";

import type { CacheProvider } from "@/application/ports/cache-provider";
import { InMemoryCacheProvider } from "@/infrastructure/cache/in-memory-cache-provider";
import { RedisCacheProvider } from "@/infrastructure/cache/redis-cache-provider";
import { getRedisClient } from "@/infrastructure/cache/redis-client-factory";

/**
 * Module 46 — Caching Layer (Roadmap Module 13).
 *
 * The single place that decides which `CacheProvider` implementation a
 * given process gets — same factory-function shape as Module 44's own
 * `cache-service-factory.ts`: `RedisCacheProvider` when `REDIS_URL` is
 * configured, `InMemoryCacheProvider` otherwise. A single memoized
 * instance per process, reused by every `CacheManager` (see
 * `compose.ts`).
 */
let instance: CacheProvider | null = null;

export function createCacheProvider(): CacheProvider {
  if (!instance) {
    const redisClient = getRedisClient();
    instance = redisClient ? new RedisCacheProvider(redisClient) : new InMemoryCacheProvider();
  }
  return instance;
}

/** Exposed for tests only — forces the next call to re-decide. */
export const __testing = {
  reset(): void {
    instance = null;
  },
};
