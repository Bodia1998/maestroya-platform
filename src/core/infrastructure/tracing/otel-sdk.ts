import "server-only";

import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { Resource } from "@opentelemetry/resources";
import { BatchSpanProcessor, NodeTracerProvider, type SpanProcessor } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

import { logger } from "@/infrastructure/observability/logger";
import { env } from "@/infrastructure/config/env";
import { createSpanExporter } from "@/infrastructure/tracing/providers/span-exporter-factory";
import type { TracingConfig } from "@/infrastructure/tracing/tracing-config";

/**
 * Module 51 — Distributed Tracing.
 *
 * Boots the OpenTelemetry Node SDK and registers it globally. This is the
 * heavy half of the module and is **only ever loaded through a dynamic
 * `import()`** from `compose.ts`, and only when `TRACING_ENABLED=true` —
 * the identical arrangement `sentry-client.ts` (Module 39) uses for
 * `@sentry/nextjs`, and for the same two reasons that file documents: a
 * process that hasn't opted in never pays the load cost, and a
 * missing/broken SDK install degrades to "tracing unavailable" instead of
 * crashing the application at startup.
 *
 * ## What registering globally buys, beyond this module's own spans
 * Next.js 15 emits its own OpenTelemetry spans (scope `next.js`) for
 * request handling, Route Handlers, Server Components and data fetching,
 * through `@opentelemetry/api` — which is a no-op until *someone*
 * registers a provider. Registering here is therefore what turns on
 * automatic per-request HTTP tracing across the entire app without
 * touching a single route file, and `withApiTracing`
 * (`http-tracing.ts`) then adds the attributes Next.js cannot know about
 * (this codebase's request id, the authenticated user).
 *
 * ## Why `NodeTracerProvider` and not `NodeSDK`/auto-instrumentations
 * `@opentelemetry/sdk-node` plus `auto-instrumentations-node` works by
 * monkey-patching `require()` (`require-in-the-middle`), which is
 * fragile-to-hostile inside a bundled Next.js server build and would
 * additionally pull ~20 instrumentation packages into the dependency
 * tree for backends this platform does not use. Every integration point
 * this module needs already has a first-class seam in this codebase — a
 * port, a factory, an observer, or a Prisma extension — so instrumenting
 * them explicitly is both smaller and more precise than patching the
 * module loader. See docs/MODULE_51_DISTRIBUTED_TRACING.md §4.
 */

export interface StartedTracingSdk {
  /** Flushes pending spans and releases the exporter. Never throws. */
  shutdown(): Promise<void>;
  /** `true` when a span processor/exporter is actually attached. */
  exporting: boolean;
}

export function startOtelSdk(config: TracingConfig): StartedTracingSdk {
  const exporter = createSpanExporter(config);

  const spanProcessors: SpanProcessor[] = exporter
    ? [
        // Batched, never `SimpleSpanProcessor`: the simple processor
        // exports inline on `span.end()`, which would put collector
        // latency directly on the request path — the one thing this
        // module is not allowed to do.
        new BatchSpanProcessor(exporter),
      ]
    : [];

  const provider = new NodeTracerProvider({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? "0.1.0",
      // Matches `SENTRY_ENVIRONMENT`'s own rationale (env.ts): a staging
      // deployment must run with NODE_ENV=production and still be
      // distinguishable from real production in the backend.
      "deployment.environment.name": env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    }),
    spanProcessors,
  });

  provider.register({
    // W3C Trace Context (`traceparent`/`tracestate`) is the propagation
    // format for every hop in this platform — inbound HTTP, the job
    // queue's payload carrier, and outbound `fetch`. Registering it
    // explicitly (rather than relying on the default) is what makes
    // `TracingPort.inject`/`SpanOptions.parent` a single interoperable
    // format rather than an SDK default that could change.
    propagator: new W3CTraceContextPropagator(),
    // The default context manager for `NodeTracerProvider` is already
    // `AsyncLocalStorageContextManager`; left implicit so this module
    // does not pin behaviour the SDK owns.
  });

  logger.info("tracing_initialized", {
    serviceName: config.serviceName,
    exporter: config.exporter,
    exporting: spanProcessors.length > 0,
    endpoint: config.endpoint ?? undefined,
  });

  return {
    exporting: spanProcessors.length > 0,
    async shutdown(): Promise<void> {
      try {
        await provider.shutdown();
        logger.info("tracing_shutdown_complete", { serviceName: config.serviceName });
      } catch (error) {
        // Shutdown runs from `instrumentation.ts`'s SIGTERM handler,
        // alongside the Prisma/Redis/job-runtime teardown. A tracing
        // failure there must not abort the rest of that sequence.
        logger.warn("tracing_shutdown_failed", { error });
      }
    },
  };
}
