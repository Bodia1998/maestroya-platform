import "server-only";

import { CacheManager } from "@/application/services/cache/cache-manager";
import type { CacheNamespace } from "@/application/services/cache/cache-namespace";
import { env } from "@/infrastructure/config/env";
import type { CacheLayerHealthReport } from "@/infrastructure/cache/cache-health";
import { createCacheObserver } from "@/infrastructure/cache/cache-observability";
import { createCacheProvider } from "@/infrastructure/cache/cache-provider-factory";
import { getRedisClient } from "@/infrastructure/cache/redis-client-factory";

/**
 * Module 46 — Caching Layer (Roadmap Module 13).
 *
 * Composition root for the caching layer — the same manual,
 * no-DI-container convention as every other `compose.ts` in this
 * codebase (`infrastructure/jobs/compose.ts`, `infrastructure/events/compose.ts`):
 * module-level singletons, plain exported factory functions, no
 * reflection. This is the one file that:
 *
 *  1. Builds the single, process-wide `CacheManager`, wiring in
 *     `createCacheProvider()` (Redis or in-memory — see that factory's
 *     own doc comment), `createCacheObserver()` (logger/Sentry), the
 *     `CACHE_KEY_PREFIX` env var, and the `CACHE_BYPASS_ENABLED` flag.
 *  2. Exposes `getCacheHealth()`, consumed by `/api/health/ready`.
 *
 * Every application service that wants a cache calls `getCacheManager()`
 * (or `getCacheNamespace(name)` for the common single-namespace case) —
 * never `createCacheProvider()`/`new CacheManager(...)` directly, so the
 * whole process shares one manager (and therefore one set of
 * hit/miss/invalidation statistics) rather than each caller building its
 * own.
 */
let manager: CacheManager | null = null;

export function getCacheManager(): CacheManager {
  if (!manager) {
    manager = new CacheManager(createCacheProvider(), {
      keyBuilder: { prefix: env.CACHE_KEY_PREFIX },
      observer: createCacheObserver(),
      bypass: () => env.CACHE_BYPASS_ENABLED === "true",
    });
  }
  return manager;
}

/** Convenience accessor for the common case of one call site, one namespace. */
export function getCacheNamespace(name: string): CacheNamespace {
  return getCacheManager().namespace(name);
}

export function getCacheHealth(): CacheLayerHealthReport {
  return {
    status: env.CACHE_BYPASS_ENABLED === "true" ? "bypassed" : "ok",
    driver: getRedisClient() ? "redis" : "memory",
    bypass: env.CACHE_BYPASS_ENABLED === "true",
    stats: getCacheManager().getStats(),
  };
}

/** Exposed for tests only — forces the next call to rebuild the manager. */
export const __testing = {
  reset(): void {
    manager = null;
  },
};
