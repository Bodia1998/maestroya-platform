import "server-only";

import type { DistributedLock } from "@/application/ports/distributed-lock";
import { InMemoryLockService } from "@/infrastructure/locking/in-memory-lock-service";
import { RedisLockService } from "@/infrastructure/locking/redis-lock-service";
import { getRedisClient } from "@/infrastructure/cache/redis-client-factory";

/**
 * Module 44 — Redis Infrastructure (Roadmap Module 11).
 *
 * Same factory-function convention as `cache-service-factory.ts` and
 * `rate-limit-repository-factory.ts`: `RedisLockService` when
 * `REDIS_URL` is configured, `InMemoryLockService` otherwise. Memoized
 * per process.
 */
let instance: DistributedLock | null = null;

export function createDistributedLock(): DistributedLock {
  if (!instance) {
    const redisClient = getRedisClient();
    instance = redisClient ? new RedisLockService(redisClient) : new InMemoryLockService();
  }
  return instance;
}

/** Exposed for tests only — forces the next call to re-decide. */
export const __testing = {
  reset(): void {
    instance = null;
  },
};
