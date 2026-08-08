import "server-only";

import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ConsoleSpanExporter, type SpanExporter } from "@opentelemetry/sdk-trace-node";

import { logger } from "@/infrastructure/observability/logger";
import type { TracingConfig } from "@/infrastructure/tracing/tracing-config";
import { ResilientSpanExporter } from "@/infrastructure/tracing/providers/resilient-span-exporter";

/**
 * Module 51 — Distributed Tracing.
 *
 * Chooses the `SpanExporter` for the resolved `TracingConfig` — the same
 * "one memoization-free switch over the validated env, no caller knows
 * the choice" factory shape as `cache-provider-factory.ts` (Module 46),
 * `search-provider-factory.ts` (Module 47) and `sms-sender-factory.ts`
 * (Module 49).
 *
 * Returns `null` for `exporter: "none"` — a deliberate, healthy state
 * (spans are still created and *propagated*, so logs correlate and
 * downstream services join the same trace; nothing is shipped anywhere),
 * not a failure. `otel-sdk.ts` registers no span processor at all in
 * that case, which is strictly cheaper than registering one wrapped
 * around a no-op exporter.
 *
 * Every real exporter is wrapped in `ResilientSpanExporter`, so the
 * circuit-breaker behaviour is a property of *this module*, not of one
 * exporter — see that class for why dropping spans beats retrying
 * forever.
 *
 * This file is only ever reached through `otel-sdk.ts`'s dynamic
 * `import()`, i.e. only when `TRACING_ENABLED=true`; the OTLP/console
 * exporter packages are therefore never loaded by a process that has
 * tracing off.
 */
export function createSpanExporter(config: TracingConfig): SpanExporter | null {
  switch (config.exporter) {
    case "otlp": {
      if (!config.endpoint) {
        // `resolveTracingConfig()` already downgrades this combination to
        // `"none"`, so reaching here means the config was built by hand
        // (a test). Warn and degrade rather than construct an exporter
        // that cannot work — `createSearchProvider()`'s missing-host
        // branch, exactly.
        logger.warn("tracing_exporter_misconfigured", {
          exporter: "otlp",
          reason: "OTEL_EXPORTER_OTLP_ENDPOINT is not set — no spans will be exported.",
        });
        return null;
      }

      return new ResilientSpanExporter(
        new OTLPTraceExporter({ url: config.endpoint, headers: config.headers }),
        "otlp",
      );
    }

    case "console":
      return new ResilientSpanExporter(new ConsoleSpanExporter(), "console");

    case "none":
    default:
      return null;
  }
}
