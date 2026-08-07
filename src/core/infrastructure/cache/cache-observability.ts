import "server-only";

import { createErrorReporter } from "@/infrastructure/observability/error-reporter-factory";
import { logger } from "@/infrastructure/observability/logger";
import type { CacheObserver } from "@/application/ports/cache-observer";

/**
 * Module 46 — Caching Layer (Roadmap Module 13).
 *
 * The `CacheObserver` implementation wired into `CacheManager` by
 * `compose.ts`, using exactly the same two observability seams every
 * other module in this codebase already reports through: `logger`
 * (Module 25) and `createErrorReporter()` (Module 39, Sentry). No new
 * transport, matching Module 45's `job-observability.ts` precedent
 * exactly.
 *
 * ## What is reported where, and why
 * - `hit` / `miss` / `set` / `delete` → `logger.debug`. High-volume,
 *   individually uninteresting (gated out by `LOG_LEVEL` in production
 *   by default) — useful when tracing one key's lifecycle, noise
 *   otherwise. Aggregate hit/miss counts are what the health endpoint
 *   reports instead (see `cache-health.ts`), not a log line per read.
 * - `invalidate` → `logger.info`. An operator- or application-triggered
 *   event (a namespace bump, a wildcard clear) that is infrequent and
 *   operationally worth a durable record, unlike a routine read.
 * - `error` → `logger.warn` **plus** `createErrorReporter().reportException`.
 *   A cache backend failure is, by this module's own design, never
 *   allowed to fail the caller's request (every `CacheManager` method
 *   swallows a provider error and degrades to a miss/no-op) — but a
 *   cache that is silently failing every operation is exactly the kind
 *   of thing an operator needs to know about, hence `warn` (not `error`
 *   — no request actually failed) plus a Sentry report for trend
 *   visibility.
 */
export function createCacheObserver(): CacheObserver {
  return {
    onHit({ namespace, key }) {
      logger.debug("cache_hit", { namespace, key });
    },

    onMiss({ namespace, key }) {
      logger.debug("cache_miss", { namespace, key });
    },

    onSet({ namespace, key, ttlMs }) {
      logger.debug("cache_set", { namespace, key, ttlMs });
    },

    onDelete({ namespace, key }) {
      logger.debug("cache_delete", { namespace, key });
    },

    onInvalidate({ namespace, scope, target, count }) {
      logger.info("cache_invalidated", { namespace, scope, target, count });
    },

    onError({ operation, namespace, key, error }) {
      logger.warn("cache_operation_failed", { operation, namespace, key, error });

      createErrorReporter().reportException(error, {
        tags: { source: "caching-layer", operation },
        extra: { namespace, key },
      });
    },
  };
}
