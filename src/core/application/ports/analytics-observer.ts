/**
 * Module 50 — Analytics Dashboard (CQRS Read Model).
 *
 * Observability seam every analytics use case depends on — never
 * `logger`/Sentry directly — mirroring `SearchObserver` (Module 47) and
 * `CacheObserver` (Module 46) exactly. `infrastructure/analytics/
 * analytics-observability.ts` is the one implementation, routing through
 * the two seams this codebase already has.
 */
export interface AnalyticsCacheHitEvent {
  ageMs: number;
}

export interface AnalyticsCacheMissEvent {
  reason: "empty" | "expired";
}

export interface AnalyticsRefreshCompletedEvent {
  trigger: "event" | "scheduled" | "manual-rebuild" | "on-demand";
  reason: string;
  durationMs: number;
}

export interface AnalyticsRefreshFailedEvent {
  trigger: "event" | "scheduled" | "manual-rebuild" | "on-demand";
  reason: string;
  error: unknown;
}

export interface AnalyticsDegradedEvent {
  operation: string;
  error: unknown;
}

export interface AnalyticsObserver {
  onCacheHit(event: AnalyticsCacheHitEvent): void;
  onCacheMiss(event: AnalyticsCacheMissEvent): void;
  onRefreshCompleted(event: AnalyticsRefreshCompletedEvent): void;
  onRefreshFailed(event: AnalyticsRefreshFailedEvent): void;
  /** The read side found nothing usable (no cache, live compute also
   *  failed) and degraded to a null-data snapshot rather than throwing. */
  onDegraded(event: AnalyticsDegradedEvent): void;
}

/** Null object — same convention as `nullSearchObserver`. */
export const nullAnalyticsObserver: AnalyticsObserver = {
  onCacheHit() {},
  onCacheMiss() {},
  onRefreshCompleted() {},
  onRefreshFailed() {},
  onDegraded() {},
};
