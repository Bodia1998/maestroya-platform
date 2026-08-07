import type { CacheStatsSnapshot } from "@/application/services/cache/cache-stats";

/**
 * Module 46 — Caching Layer (Roadmap Module 13).
 *
 * The shape `/api/health/ready` reports for the caching layer, alongside
 * `checks.cache` (Module 44's raw Redis `PING`) and `checks.queue`
 * (Module 45). Joins both in the "operational visibility only" category
 * that route's own doc comment establishes: `CacheManager` already
 * degrades every operation to a safe miss/no-op on a provider failure
 * (see `cache-manager.ts`), so a struggling cache is never this
 * instance's reason to stop serving HTTP traffic — reported, never
 * allowed to change the response's overall status or HTTP code.
 */
export type CacheLayerHealthStatus = "ok" | "bypassed";

export interface CacheLayerHealthReport {
  status: CacheLayerHealthStatus;
  /** Which `CacheProvider` backs this process — `"redis"` or `"memory"`. */
  driver: "redis" | "memory";
  bypass: boolean;
  stats: CacheStatsSnapshot;
}
