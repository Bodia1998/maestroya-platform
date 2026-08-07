import "server-only";

import type { RateLimitRepository } from "@/domain/repositories/rate-limit-repository";
import { InMemoryRateLimitRepository } from "@/infrastructure/security/in-memory-rate-limit-repository";
import { RedisRateLimitRepository } from "@/infrastructure/security/redis-rate-limit-repository";
import { getRedisClient } from "@/infrastructure/cache/redis-client-factory";

/**
 * Module 44 — Redis Infrastructure (Roadmap Module 11).
 *
 * The single place that decides which `RateLimitRepository`
 * implementation this process gets: `RedisRateLimitRepository` when
 * `REDIS_URL` is configured (shared, correctly-enforced across every
 * instance of a multi-instance deployment), `InMemoryRateLimitRepository`
 * otherwise (local dev, most CI runs, and any deployment that is
 * genuinely single-instance today). This is exactly the "drop-in swap at
 * `application/use-cases/security/compose.ts`, zero caller changes"
 * moment `docs/MODULE_25_PRODUCTION_INFRASTRUCTURE.md` (§14, §29) and
 * `InMemoryRateLimitRepository`'s own doc comment both predicted.
 *
 * Memoized per process (same convention as `error-reporter-factory.ts`,
 * `cache-service-factory.ts`) — `AntiAbuseService` must observe the same
 * repository instance across requests within one process; a fresh
 * instance per call would make either backend's in-process state
 * meaningless.
 */
let instance: RateLimitRepository | null = null;

export function createRateLimitRepository(): RateLimitRepository {
  if (!instance) {
    const redisClient = getRedisClient();
    instance = redisClient
      ? new RedisRateLimitRepository(redisClient)
      : new InMemoryRateLimitRepository();
  }
  return instance;
}

/** Exposed for tests only — forces the next call to re-decide. */
export const __testing = {
  reset(): void {
    instance = null;
  },
};
