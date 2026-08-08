import type { AnalyticsObserver } from "@/application/ports/analytics-observer";
import { createErrorReporter } from "@/infrastructure/observability/error-reporter-factory";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 50 — Analytics Dashboard (CQRS Read Model).
 *
 * The `AnalyticsObserver` implementation wired into every analytics use
 * case by `compose.ts` — mirrors `search-observability.ts`/
 * `job-observability.ts`/`cache-observability.ts` exactly: no new
 * transport, everything through the existing `logger` and
 * `createErrorReporter()`.
 *
 * - `cacheHit`/`cacheMiss` → `logger.debug`. High volume (one per
 *   dashboard read), individually uninteresting, useful for tuning the
 *   TTL.
 * - `refreshCompleted` → `logger.info`. Infrequent (one per coalesced
 *   recompute), genuinely worth a durable trail of "when did the
 *   dashboard last change."
 * - `refreshFailed` → `logger.error` + Sentry. The job layer's own
 *   `onFailed` reports the same failure once attempts are exhausted; this
 *   fires on every failed attempt with analytics-specific context — the
 *   same deliberate double-reporting `search-observability.ts` documents.
 * - `degraded` (the *read* side found nothing usable) → `logger.warn` +
 *   Sentry. No request failed, but an admin is seeing "analytics
 *   unavailable," worth a trend line.
 */
export function createAnalyticsObserver(): AnalyticsObserver {
  return {
    onCacheHit({ ageMs }) {
      logger.debug("analytics_dashboard_cache_hit", { ageMs });
    },

    onCacheMiss({ reason }) {
      logger.debug("analytics_dashboard_cache_miss", { reason });
    },

    onRefreshCompleted({ trigger, reason, durationMs }) {
      logger.info("analytics_dashboard_refreshed", { trigger, reason, durationMs });
    },

    onRefreshFailed({ trigger, reason, error }) {
      logger.error("analytics_dashboard_refresh_failed", { trigger, reason, error });

      createErrorReporter().reportException(error, {
        tags: { source: "analytics-dashboard", trigger, stage: "write" },
        extra: { reason },
      });
    },

    onDegraded({ operation, error }) {
      logger.warn("analytics_dashboard_degraded", { operation, error });

      createErrorReporter().reportException(error, {
        tags: { source: "analytics-dashboard", operation, stage: "read" },
      });
    },
  };
}
