import "server-only";

import type { TraceContext } from "@/application/ports/tracing";
import { getSentry, isSentryConfigured } from "@/infrastructure/observability/sentry-client";

/**
 * Module 51 — Distributed Tracing × Module 39 — Sentry.
 *
 * Ties the two observability systems together at the only place where
 * that is both cheap and unambiguous: the inbound request boundary.
 *
 * ## What this does, and deliberately does not, do
 * It does **not** install Sentry's OpenTelemetry integration, replace
 * Sentry's own performance tracing, or route this module's spans into
 * Sentry. Sentry's tracing is governed by `SENTRY_TRACES_SAMPLE_RATE`
 * (default `0` — see `env.ts`) and is a separate, independently
 * configurable concern; making one module silently reconfigure another's
 * sampling would be exactly the kind of hidden coupling
 * `EVENT_QUEUE_ENABLED`'s doc comment argues against.
 *
 * What it *does* is the one thing an operator actually needs: it stamps
 * the current `trace_id`/`span_id` onto Sentry's scope, so that an
 * exception reported by `SentryErrorReporter` carries the id of the trace
 * it happened inside. That turns "here is a stack trace" into "here is a
 * stack trace, and here is the full HTTP → queue → worker → database
 * timeline around it" — a one-click join between the two tools, with no
 * change to Module 39's reporters, factories, or `instrumentation.ts`'s
 * `onRequestError` hook.
 *
 * Total by construction: never throws, never awaits on the request path
 * (Sentry's module load is already memoized and lazy — see
 * `sentry-client.ts`), and is a no-op whenever Sentry is unconfigured,
 * which is every local dev and CI run.
 */
export function attachSentryTraceContext(traceContext: TraceContext | null): void {
  if (!traceContext || !isSentryConfigured()) return;

  // Fire-and-forget: `getSentry()` resolves from a memoized promise after
  // the first call, and a failure to load Sentry is already handled (and
  // logged once) inside that function. Awaiting here would put an
  // avoidable microtask on every single request for a purely
  // correlational side effect.
  void getSentry()
    .then((sentry) => {
      sentry?.setTags({ trace_id: traceContext.traceId, span_id: traceContext.spanId });
    })
    .catch(() => {
      /* Sentry correlation is best-effort; see this file's doc comment. */
    });
}
