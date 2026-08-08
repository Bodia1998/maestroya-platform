import type { TraceCarrier } from "@/application/ports/tracing";

/**
 * Module 51 — Distributed Tracing.
 *
 * Conversions between a `TraceCarrier` (the port's flat string map) and
 * the two concrete shapes trace context actually travels in.
 *
 * Framework-agnostic on purpose — no `next/server`, no
 * `@opentelemetry/*` — for the same reason `request-id.ts` (Module 25) is:
 * so it can be unit-tested without a request object and reused from the
 * Node runtime, the standalone realtime gateway process
 * (`scripts/realtime-gateway.ts`), and a plain job payload alike.
 *
 * Only the W3C Trace Context keys are ever copied. Copying *all* inbound
 * headers into a carrier would work with the current propagator but would
 * silently start forwarding cookies and `Authorization` into job payloads
 * the day a propagator that reads more keys is configured — a trace
 * carrier that ends up persisted in Redis must contain trace context and
 * nothing else. This is the same trust-boundary discipline
 * `resolveRequestId` applies to `x-request-id`.
 */

/** The only header names this module ever propagates. */
export const TRACE_CONTEXT_HEADERS = ["traceparent", "tracestate"] as const;

/** Extracts the W3C trace-context headers from any `Headers`-like object. */
export function carrierFromHeaders(headers: Headers): TraceCarrier {
  const carrier: TraceCarrier = {};
  for (const name of TRACE_CONTEXT_HEADERS) {
    const value = headers.get(name);
    if (value) carrier[name] = value;
  }
  return carrier;
}

/** Extracts them from a plain record (a job payload, a WebSocket frame). */
export function carrierFromRecord(record: Record<string, unknown> | null | undefined): TraceCarrier {
  const carrier: TraceCarrier = {};
  if (!record) return carrier;

  for (const name of TRACE_CONTEXT_HEADERS) {
    const value = record[name];
    if (typeof value === "string" && value) carrier[name] = value;
  }
  return carrier;
}

/** Writes a carrier onto outbound request headers, in place. */
export function applyCarrierToHeaders(carrier: TraceCarrier, headers: Headers): void {
  for (const [key, value] of Object.entries(carrier)) {
    if (value) headers.set(key, value);
  }
}

/**
 * `true` when a carrier actually holds something to continue a trace
 * from. An empty carrier means "start a fresh trace", never an error —
 * see `SpanOptions.parent`.
 */
export function hasTraceContext(carrier: TraceCarrier | null | undefined): boolean {
  return Boolean(carrier && Object.keys(carrier).length > 0);
}
