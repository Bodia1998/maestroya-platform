import "server-only";

import { env } from "@/infrastructure/config/env";

/**
 * Module 51 — Distributed Tracing.
 *
 * Turns the five validated `TRACING_*`/`OTEL_*` environment variables
 * into the one resolved shape the rest of this module reads — the same
 * "decide once, from the validated env, in a single named place" role
 * `search-provider-factory.ts` (Module 47) and `sms-sender-factory.ts`
 * (Module 49) play for their own modules.
 *
 * Kept deliberately separate from `compose.ts` so that the *decision*
 * ("is tracing on, and where do spans go?") is unit-testable — and
 * readable in the health report — without constructing an SDK, opening a
 * network exporter, or registering anything globally.
 */

/**
 * Where finished spans are written.
 *
 *  - `console` — `ConsoleSpanExporter`, the local-development default.
 *    No network, no collector, no account: `TRACING_ENABLED=true` alone
 *    gives a developer a working trace on stdout.
 *  - `otlp` — OTLP/HTTP to `OTEL_EXPORTER_OTLP_ENDPOINT`. The production
 *    choice (Grafana Tempo, Jaeger, Honeycomb, Datadog, Sentry's own OTLP
 *    endpoint — all speak it).
 *  - `none` — spans are created and propagated but never exported. The
 *    useful middle state for measuring the overhead of instrumentation
 *    itself, and for a process that only needs trace *context* (so its
 *    logs and downstream calls correlate) without shipping anything.
 */
export type TracingExporterName = "console" | "otlp" | "none";

export interface TracingConfig {
  /** `TRACING_ENABLED === "true"`. Opt-in — see `env.ts`. */
  enabled: boolean;
  exporter: TracingExporterName;
  serviceName: string;
  /** Only meaningful for `exporter === "otlp"`. */
  endpoint: string | null;
  /** Parsed `OTEL_EXPORTER_HEADERS` — auth headers for the collector. */
  headers: Record<string, string>;
}

export const DEFAULT_TRACING_SERVICE_NAME = "maestroya-platform";

/**
 * Parses the OTLP header list. The format is the OpenTelemetry
 * specification's own `OTEL_EXPORTER_OTLP_HEADERS` grammar — a
 * comma-separated list of `key=value` pairs, e.g.
 * `"x-api-key=abc,x-tenant=maestroya"` — so an operator can copy a value
 * straight out of their collector's documentation.
 *
 * Never throws. A malformed entry (no `=`, empty key) is skipped rather
 * than failing startup: this is an operational convenience field, and
 * the same "a typo in a non-critical knob must degrade, never crash the
 * app" rule `GEOCODING_PROVIDER`/`QUEUE_CONCURRENCY` follow in `env.ts`
 * applies to its contents too, not just its presence.
 */
export function parseExporterHeaders(raw: string | undefined | null): Record<string, string> {
  if (!raw) return {};

  const headers: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;

    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!key) continue;

    headers[key] = value;
  }
  return headers;
}

export function resolveTracingConfig(): TracingConfig {
  const enabled = env.TRACING_ENABLED === "true";

  return {
    enabled,
    // An `otlp` selection with no endpoint cannot export anything, so it
    // is downgraded to `none` rather than constructing an exporter that
    // will fail on every flush. Same "fall back to the safe local option
    // instead of a guaranteed-broken one" rule as
    // `createSearchProvider()`'s missing-host branch. `env.ts` separately
    // makes this combination a hard startup failure in production, where
    // silently exporting nothing would be the wrong kind of quiet.
    exporter: env.TRACING_EXPORTER === "otlp" && !env.OTEL_EXPORTER_OTLP_ENDPOINT ? "none" : env.TRACING_EXPORTER,
    serviceName: env.OTEL_SERVICE_NAME ?? DEFAULT_TRACING_SERVICE_NAME,
    endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT ?? null,
    headers: parseExporterHeaders(env.OTEL_EXPORTER_HEADERS),
  };
}
