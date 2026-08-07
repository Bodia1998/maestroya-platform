import type { QueueCounts } from "@/infrastructure/jobs/job-types";

/**
 * Module 45 — Background Jobs (Roadmap Module 12).
 *
 * The shape `/api/health/ready` reports for the job system. It joins
 * `checks.cache` in that route's "operational visibility only" category
 * — reported, never allowed to change the response's overall status or
 * HTTP code — for the reason that route's own doc comment already
 * establishes for Redis: a degraded background-job system is not this
 * instance's failure to serve HTTP traffic, and returning 503 for it
 * would trigger pointless failover on a problem restarting the instance
 * cannot fix.
 *
 * `"disabled"` (queued dispatch off — the default) is a healthy, normal
 * state, exactly like `checks.cache`'s existing `"not_configured"`.
 */
export type QueueHealthStatus = "ok" | "error" | "disabled";

export interface QueueHealthReport {
  status: QueueHealthStatus;
  /** Where jobs are stored — `"redis"` when REDIS_URL is set, `"memory"` otherwise. */
  driver: "redis" | "memory" | "none";
  queues: Record<string, QueueCounts>;
  /** Present only when `status` is `"error"`. */
  error?: string;
}

export const DISABLED_QUEUE_HEALTH: QueueHealthReport = { status: "disabled", driver: "none", queues: {} };

export interface QueueHealthSource {
  readonly name: string;
  getCounts(): Promise<QueueCounts>;
}

/**
 * Collects counts from every registered queue. Never throws — a failing
 * health *check* must not itself become an incident, so a store error is
 * folded into `status: "error"` with its message, matching how
 * `checkCache()` in the readiness route already treats a failed `PING`.
 */
export async function collectQueueHealth(
  queues: readonly QueueHealthSource[],
  driver: QueueHealthReport["driver"],
): Promise<QueueHealthReport> {
  const report: Record<string, QueueCounts> = {};

  try {
    for (const queue of queues) {
      report[queue.name] = await queue.getCounts();
    }
    return { status: "ok", driver, queues: report };
  } catch (error) {
    return {
      status: "error",
      driver,
      queues: report,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
