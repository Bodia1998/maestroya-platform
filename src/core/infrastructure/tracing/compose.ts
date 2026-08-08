import "server-only";

import { nullTracer, type TracingPort } from "@/application/ports/tracing";
import { TracingService } from "@/application/services/tracing/tracing-service";
import { logger } from "@/infrastructure/observability/logger";
import { OtelTracer } from "@/infrastructure/tracing/otel-tracer";
import { resolveTracingConfig, type TracingConfig } from "@/infrastructure/tracing/tracing-config";
import {
  collectTracingHealth,
  DISABLED_TRACING_HEALTH,
  type TracingHealthReport,
} from "@/infrastructure/tracing/tracing-health";

/**
 * Module 51 — Distributed Tracing.
 *
 * Composition root — the same manual, no-DI-container convention as every
 * other `compose.ts` in this codebase (`infrastructure/cache/compose.ts`,
 * `infrastructure/jobs/compose.ts`, `infrastructure/analytics/compose.ts`):
 * module-level singletons, plain exported factory functions,
 * `__testing.reset()`, no reflection.
 *
 * This one file owns exactly four things:
 *
 *  1. **The tracer** — `getTracer()`, the single process-wide
 *     `TracingPort`. `nullTracer` when `TRACING_ENABLED` is not
 *     `"true"`; an `OtelTracer` otherwise. Every instrumentation point in
 *     the platform (HTTP wrapper, event bus, jobs, Prisma, cache, search,
 *     `fetch`) resolves its tracer through here and nowhere else, so the
 *     whole process shares one decision.
 *  2. **The application service** — `getTracingService()`, for
 *     application-layer callers that want the named helpers rather than
 *     the raw port.
 *  3. **Lifecycle** — `startTracing()` / `shutdownTracing()`, called from
 *     `instrumentation.ts`'s existing boot and SIGTERM/SIGINT hooks. This
 *     module adds no signal handlers of its own; hooking into the one
 *     graceful-shutdown path that already exists is the point, exactly as
 *     `jobs/compose.ts` documents for its own runtime.
 *  4. **Health** — `getTracingHealth()`, consumed by `/api/health/ready`.
 *
 * ## The disabled path, in full
 * With `TRACING_ENABLED` unset (the default, and what every existing test
 * and local dev run gets):
 *
 *   - `getTracer()` returns the port's shared `nullTracer` — an object
 *     literal of empty functions. No span is ever allocated.
 *   - `startTracing()` returns immediately. `otel-sdk.ts`, the exporter
 *     factory, and therefore `@opentelemetry/sdk-trace-node` and
 *     `@opentelemetry/exporter-trace-otlp-http` are never imported.
 *   - Every wrapper in this module (`withApiTracing`, `TracedEventBus`,
 *     `withPrismaTracing`, `withJobTracing`, `createTracedFetch`, the
 *     cache/search decorators) checks `tracer.enabled` and returns the
 *     *undecorated* object, so not even a delegating call frame is added.
 *
 * That is what "completely optional, effectively zero overhead when
 * disabled" means concretely, and it is asserted by the unit tests in
 * `tests/unit/core/infrastructure/tracing/`.
 */

let config: TracingConfig | null = null;
let tracer: TracingPort | null = null;
let service: TracingService | null = null;
let sdk: { shutdown(): Promise<void>; exporting: boolean } | null = null;
let starting: Promise<void> | null = null;
let failureReason: string | null = null;

function getConfig(): TracingConfig {
  if (!config) config = resolveTracingConfig();
  return config;
}

/** Cheap, allocation-free predicate — safe to call on any hot path. */
export function isTracingEnabled(): boolean {
  return getConfig().enabled;
}

/**
 * The single process-wide `TracingPort`. Safe to call before
 * `startTracing()` — until the SDK registers a provider, OpenTelemetry's
 * own API hands back non-recording spans, so an early call is inert
 * rather than an error (the same "importing this is side-effect-free in
 * the common case" property `redis-client-factory.ts` has).
 */
export function getTracer(): TracingPort {
  if (!tracer) tracer = getConfig().enabled ? new OtelTracer() : nullTracer;
  return tracer;
}

export function getTracingService(): TracingService {
  if (!service) service = new TracingService(getTracer());
  return service;
}

/**
 * Boots the OpenTelemetry SDK. Idempotent and concurrency-safe (the
 * in-flight promise is memoized), and a no-op when tracing is disabled.
 * Called once from `instrumentation.ts`, as early as possible — before
 * `startBackgroundJobs()`, so a job that runs during boot is already
 * traceable.
 *
 * **Never throws.** A tracing SDK that cannot start must not prevent the
 * application from starting; the failure is logged, recorded for
 * `checks.tracing` to report as `degraded`, and the process continues
 * with a tracer whose spans are simply never exported. This mirrors
 * `sentry-client.ts`'s `.catch()` on its own dynamic import exactly.
 */
export async function startTracing(): Promise<void> {
  if (!getConfig().enabled || sdk) return;
  if (starting) return starting;

  starting = (async () => {
    try {
      const { startOtelSdk } = await import("@/infrastructure/tracing/otel-sdk");
      sdk = startOtelSdk(getConfig());
      failureReason = null;
    } catch (error) {
      failureReason = error instanceof Error ? error.message : String(error);
      logger.error("tracing_init_failed", {
        error,
        reason:
          "The OpenTelemetry SDK failed to start. The application continues normally; " +
          "spans are created but never exported (checks.tracing reports 'degraded').",
      });
    } finally {
      starting = null;
    }
  })();

  return starting;
}

/**
 * Flushes and releases the SDK. Idempotent, safe to call when tracing was
 * never started, and never throws — all three matter because
 * `instrumentation.ts` invokes it from SIGTERM/SIGINT on a process that
 * may never have enabled tracing at all, alongside the Prisma, job-runtime
 * and Redis teardown it must not disrupt.
 */
export async function shutdownTracing(): Promise<void> {
  if (!sdk) return;
  const current = sdk;
  sdk = null;
  await current.shutdown();
}

export function getTracingHealth(): TracingHealthReport {
  const resolved = getConfig();
  if (!resolved.enabled) return DISABLED_TRACING_HEALTH;

  return collectTracingHealth({
    enabled: true,
    exporter: resolved.exporter,
    serviceName: resolved.serviceName,
    started: sdk !== null,
    failureReason,
  });
}

/** Exposed for tests only — drops every singleton so the next call rebuilds. */
export const __testing = {
  reset(): void {
    config = null;
    tracer = null;
    service = null;
    sdk = null;
    starting = null;
    failureReason = null;
  },
  /** Lets a test assert the disabled/enabled decision without booting the SDK. */
  get config(): TracingConfig | null {
    return config;
  },
};
