import "server-only";

import type { RateLimitRepository } from "@/domain/repositories/rate-limit-repository";
import { InMemoryRateLimitRepository } from "@/infrastructure/security/in-memory-rate-limit-repository";
import { RedisRateLimitRepository } from "@/infrastructure/security/redis-rate-limit-repository";
import { getRedisClient } from "@/infrastructure/cache/redis-client-factory";
import { isProduction } from "@/infrastructure/config/env";

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

    // Module 82 — Admin RBAC & Production Auth Hardening (H10): belt-and-
    // suspenders alongside env.ts's own production `REDIS_URL` requirement
    // (see that file's superRefine) — `env.ts` already refuses to let a
    // production process start at all without a valid `REDIS_URL`, so
    // `redisClient` below should be unreachable as `null` here in
    // production. This check exists purely so this factory can never
    // silently select `InMemoryRateLimitRepository` in production even if
    // that startup guarantee is ever weakened or bypassed (e.g. a future
    // refactor of `getRedisClient()`/`env.ts`) — it fails loudly instead of
    // degrading rate limiting to per-instance behavior.
    if (!redisClient && isProduction) {
      throw new Error(
        "Refusing to create an in-memory rate limiter in production — REDIS_URL must be configured. " +
          "This should be unreachable: env.ts already requires REDIS_URL in production.",
      );
    }

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
