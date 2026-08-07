import "server-only";

import { getRedisClient } from "@/infrastructure/cache/redis-client-factory";
import { InMemoryJobStore } from "@/infrastructure/jobs/in-memory-job-store";
import type { JobStore } from "@/infrastructure/jobs/job-store";
import { RedisJobStore } from "@/infrastructure/jobs/redis-job-store";

/**
 * Module 45 — Background Jobs (Roadmap Module 12).
 *
 * Decides which `JobStore` this process gets — the identical
 * factory-function shape as `cache-service-factory.ts`,
 * `lock-service-factory.ts`, and `error-reporter-factory.ts`:
 * `RedisJobStore` when `REDIS_URL` is configured (via the one shared
 * `getRedisClient()` from Module 44 — no second client, no second
 * factory), `InMemoryJobStore` otherwise. Memoized per process so every
 * queue and worker in the app shares one store; two stores would mean a
 * worker polling a queue nothing enqueues into.
 */
let instance: JobStore | null = null;

export function createJobStore(): JobStore {
  if (!instance) {
    const redisClient = getRedisClient();
    instance = redisClient ? new RedisJobStore(redisClient) : new InMemoryJobStore();
  }
  return instance;
}

/** Exposed for tests only — forces the next call to re-decide. */
export const __testing = {
  reset(): void {
    instance = null;
  },
};
