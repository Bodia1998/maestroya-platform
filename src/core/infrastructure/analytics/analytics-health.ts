import type { QueueCounts } from "@/infrastructure/jobs/job-types";

/**
 * Module 50 — Analytics Dashboard (CQRS Read Model).
 *
 * The shape `/api/health/ready` reports for the analytics read model,
 * joining `checks.searchEngine` (Module 47) and `checks.smsProvider`
 * (Module 49) in the "operational visibility only" category — reported,
 * never allowed to change the response's overall status or HTTP code.
 * The reasoning is identical: the dashboard is *derived* data, Postgres
 * (via Module 23) remains the source of truth, and
 * `GetDashboardAnalyticsUseCase` already degrades an unreachable store
 * *and* a failed live recompute to a `{ data: null, degraded: true }`
 * snapshot rather than an error. An instance whose analytics cache is
 * down still serves every page, booking, and payment.
 *
 * `"disabled"` (`ANALYTICS_REFRESH_ENABLED=false` — the automatic
 * event/scheduled refresh pipeline switched off) is a healthy, deliberate
 * state, exactly like `checks.searchEngine`'s own `"disabled"`. Reads
 * keep working via `GetDashboardAnalyticsUseCase`'s on-demand live
 * fallback even while disabled.
 */
export type AnalyticsHealthStatus = "ok" | "degraded" | "disabled";

export interface AnalyticsHealthReport {
  status: AnalyticsHealthStatus;
  refreshEnabled: boolean;
  /** Whether the store currently holds a snapshot at all. */
  hasSnapshot: boolean;
  lastComputedAt: string | null;
  lastSource: string | null;
  /** Counts for the analytics-refresh queue and its dead-letter queue. */
  queue: Record<string, QueueCounts>;
}

export const DISABLED_ANALYTICS_HEALTH: AnalyticsHealthReport = {
  status: "disabled",
  refreshEnabled: false,
  hasSnapshot: false,
  lastComputedAt: null,
  lastSource: null,
  queue: {},
};

export interface AnalyticsHealthInputs {
  refreshEnabled: boolean;
  snapshot: { computedAt: Date; source: string; degraded: boolean } | null;
  queues: readonly { readonly name: string; getCounts(): Promise<QueueCounts> }[];
}

/**
 * Collects the report. Never throws — a failing health *check* must not
 * itself become an incident, mirroring `collectSearchEngineHealth`.
 */
export async function collectAnalyticsHealth(inputs: AnalyticsHealthInputs): Promise<AnalyticsHealthReport> {
  const queue: Record<string, QueueCounts> = {};
  let queueError = false;
  try {
    for (const source of inputs.queues) {
      queue[source.name] = await source.getCounts();
    }
  } catch {
    queueError = true;
  }

  const degraded = queueError || inputs.snapshot?.degraded === true;

  return {
    status: degraded ? "degraded" : "ok",
    refreshEnabled: inputs.refreshEnabled,
    hasSnapshot: inputs.snapshot !== null,
    lastComputedAt: inputs.snapshot?.computedAt.toISOString() ?? null,
    lastSource: inputs.snapshot?.source ?? null,
    queue,
  };
}
