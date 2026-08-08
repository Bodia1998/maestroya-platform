import "server-only";

import type { CacheProvider } from "@/application/ports/cache-provider";
import { InMemoryCacheProvider } from "@/infrastructure/cache/in-memory-cache-provider";
import { RedisCacheProvider } from "@/infrastructure/cache/redis-cache-provider";
import { getRedisClient } from "@/infrastructure/cache/redis-client-factory";
import { getTracer } from "@/infrastructure/tracing/compose";
import { withCacheTracing } from "@/infrastructure/tracing/traced-cache-provider";

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
    // Module 51 — Distributed Tracing: a decorator over the same
    // `CacheProvider` port, returned untouched when tracing is disabled.
    // Applied here so `CacheManager` and every namespace above it are
    // instrumented without knowing, exactly as the Redis/in-memory choice
    // itself is invisible to them.
    instance = withCacheTracing(
      redisClient ? new RedisCacheProvider(redisClient) : new InMemoryCacheProvider(),
      getTracer(),
      redisClient ? "redis" : "memory",
    );
  }
  return instance;
}

/** Exposed for tests only — forces the next call to re-decide. */
export const __testing = {
  reset(): void {
    instance = null;
  },
};
