import "server-only";

import { env } from "@/infrastructure/config/env";
import { RedisClient } from "@/infrastructure/cache/redis-client";

/**
 * Module 44 — Redis Infrastructure (Roadmap Module 11).
 *
 * The single shared `RedisClient` instance for the whole process — same
 * `globalThis`-free module-singleton convention as
 * `error-reporter-factory.ts` (memoized `let instance`, not
 * `globalThis`-cached like the Prisma client, since a `RedisClient` isn't
 * a connection *pool* that needs to survive Next.js dev-mode hot-reload
 * the way a `PrismaClient` does — a fresh `RedisClient` reconnecting
 * lazily on next use is cheap and correct).
 *
 * Returns `null` when `REDIS_URL` is not configured — the documented,
 * intended default for local dev, most CI runs, and any single-instance
 * deployment (see `env.ts`'s own comment on `REDIS_URL`). Every consumer
 * (`cache-service-factory.ts`, `rate-limit-repository-factory.ts`,
 * `lock-service-factory.ts`) treats `null` as "fall back to the
 * in-memory/no-op implementation", never as an error.
 */
let instance: RedisClient | null | undefined;

export function getRedisClient(): RedisClient | null {
  if (instance === undefined) {
    instance = env.REDIS_URL ? new RedisClient({ url: env.REDIS_URL }) : null;
  }
  return instance;
}

/** Exposed for tests only — forces the next call to re-decide. */
export const __testing = {
  reset(): void {
    instance = undefined;
  },
};
