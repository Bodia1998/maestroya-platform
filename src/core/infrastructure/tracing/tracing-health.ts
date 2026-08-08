import type { TracingExporterName } from "@/infrastructure/tracing/tracing-config";

/**
 * Module 51 — Distributed Tracing.
 *
 * The shape `/api/health/ready` reports for tracing under
 * `checks.tracing` — joining `checks.cache` (Module 44), `checks.queue`
 * (Module 45), `checks.cachingLayer` (Module 46), `checks.searchEngine`
 * (Module 47), `checks.realtime` (Module 48), `checks.smsProvider`
 * (Module 49) and `checks.analytics` (Module 50) in that route's
 * established **"operational visibility only"** category: reported, never
 * allowed to change the response's overall `status` or HTTP code.
 *
 * This check has the strongest claim to that category of all of them.
 * Tracing produces *diagnostic data about work the platform already
 * did*. An instance whose collector is unreachable serves every page,
 * takes every booking and processes every payment identically — the only
 * thing lost is the operator's own view. A 503 here would trigger a
 * failover that cannot fix a collector outage and would remove a healthy
 * instance from rotation for a purely observational fault.
 *
 * `"disabled"` (`TRACING_ENABLED` unset — the default) is a healthy,
 * deliberate state, exactly like `checks.searchEngine`'s and
 * `checks.analytics`'s own `"disabled"`, and `checks.cache`'s
 * `"not_configured"`.
 *
 * `"degraded"` means tracing is on but spans are not reaching the
 * backend: either the SDK failed to start (see `compose.ts`'s
 * `startTracing()`) or the exporter tripped its circuit breaker (see
 * `ResilientSpanExporter`). Trace context, correlation ids and log
 * correlation all keep working in that state — which is precisely why it
 * is `degraded` and not `error`.
 */
export type TracingHealthStatus = "ok" | "degraded" | "disabled";

export interface TracingHealthReport {
  status: TracingHealthStatus;
  /** Whether `TRACING_ENABLED=true` was set for this process. */
  enabled: boolean;
  /** The tracing implementation in use — `"opentelemetry"` or `"none"`. */
  provider: string;
  /** The selected span exporter (`console` | `otlp` | `none`). */
  exporter: TracingExporterName;
  /** `service.name` reported on every exported span. */
  serviceName: string;
  /** Present only when `status` is `"degraded"` — why. */
  reason?: string;
}

export const DISABLED_TRACING_HEALTH: TracingHealthReport = {
  status: "disabled",
  enabled: false,
  provider: "none",
  exporter: "none",
  serviceName: "none",
};

export interface TracingHealthInputs {
  enabled: boolean;
  exporter: TracingExporterName;
  serviceName: string;
  /** Whether the SDK bootstrap completed successfully in this process. */
  started: boolean;
  /** Set when the SDK failed to start, or the exporter disabled itself. */
  failureReason?: string | null;
}

/**
 * Builds the report. Pure and total — a health *check* must never itself
 * become an incident, mirroring `collectQueueHealth`/
 * `collectSearchEngineHealth`/`collectAnalyticsHealth` exactly.
 */
export function collectTracingHealth(inputs: TracingHealthInputs): TracingHealthReport {
  if (!inputs.enabled) return DISABLED_TRACING_HEALTH;

  const degradedReason = inputs.failureReason ?? (inputs.started ? null : "The tracing SDK has not been started.");

  return {
    status: degradedReason ? "degraded" : "ok",
    enabled: true,
    provider: "opentelemetry",
    exporter: inputs.exporter,
    serviceName: inputs.serviceName,
    ...(degradedReason ? { reason: degradedReason } : {}),
  };
}
