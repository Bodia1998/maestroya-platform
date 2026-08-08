import "server-only";

import {
  context as otelContext,
  propagation,
  SpanKind as OtelSpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span as OtelSpan,
  type Tracer as OtelTracerApi,
} from "@opentelemetry/api";

import type {
  Span,
  SpanAttributes,
  SpanKind,
  SpanOptions,
  TraceCarrier,
  TraceContext,
  TracingPort,
} from "@/application/ports/tracing";

/**
 * Module 51 — Distributed Tracing.
 *
 * The `TracingPort` implementation backed by OpenTelemetry. This file —
 * together with `otel-sdk.ts` and the two exporter providers — is the
 * *only* place in the codebase allowed to import `@opentelemetry/*`, the
 * same containment rule `redis-client.ts` (Module 44),
 * `providers/meilisearch-search-provider.ts` (Module 47) and
 * `stripe/client.ts` follow for their own vendors.
 *
 * ## Why this imports `@opentelemetry/api` statically, when `otel-sdk.ts` is dynamic
 * `@opentelemetry/api` is a façade with no transport, no timers, and no
 * global side effects beyond a registry object: until a provider is
 * registered, every `trace.getTracer(...).startSpan(...)` returns the
 * SDK's own shared non-recording span. It is safe (and much simpler than
 * an async indirection on a hot path) to import unconditionally. The
 * *SDK* — the part with batching, an exporter, and a network client — is
 * only ever loaded through `otel-sdk.ts`'s dynamic `import()`, and only
 * when `TRACING_ENABLED=true`, exactly as `sentry-client.ts` (Module 39)
 * loads `@sentry/nextjs`.
 *
 * Even so, `infrastructure/tracing/compose.ts` never constructs this
 * class when tracing is disabled — it hands out `nullTracer` instead, so
 * the disabled path allocates no span objects at all rather than merely
 * cheap ones.
 *
 * ## Total by construction
 * Every method is wrapped so that a fault inside OpenTelemetry can never
 * become a fault in the traced code. `withSpan` in particular guarantees
 * the wrapped function still runs, and still returns/throws exactly what
 * it would have, even if span creation itself fails.
 */

const SPAN_KINDS: Record<SpanKind, OtelSpanKind> = {
  internal: OtelSpanKind.INTERNAL,
  server: OtelSpanKind.SERVER,
  client: OtelSpanKind.CLIENT,
  producer: OtelSpanKind.PRODUCER,
  consumer: OtelSpanKind.CONSUMER,
};

/**
 * Drops `null`/`undefined` entries. Attribute maps in this codebase are
 * routinely built with optional fields (`userId` only when
 * authenticated, `distanceKm` only for a geo query) and OpenTelemetry
 * rejects nullish attribute values — filtering here means no call site
 * needs a conditional spread.
 */
export function toOtelAttributes(attributes: SpanAttributes | undefined): Attributes {
  if (!attributes) return {};

  const result: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined) continue;
    result[key] = value;
  }
  return result;
}

class OtelSpanAdapter implements Span {
  private ended = false;

  constructor(private readonly span: OtelSpan) {}

  setAttribute(key: string, value: string | number | boolean | null | undefined): void {
    if (value === null || value === undefined) return;
    try {
      this.span.setAttribute(key, value);
    } catch {
      /* tracing must never throw into the traced code */
    }
  }

  setAttributes(attributes: SpanAttributes): void {
    try {
      this.span.setAttributes(toOtelAttributes(attributes));
    } catch {
      /* ignored, see above */
    }
  }

  addEvent(name: string, attributes?: SpanAttributes): void {
    try {
      this.span.addEvent(name, toOtelAttributes(attributes));
    } catch {
      /* ignored, see above */
    }
  }

  recordException(error: unknown): void {
    try {
      this.span.recordException(error instanceof Error ? error : { message: String(error) });
    } catch {
      /* ignored, see above */
    }
  }

  setStatus(status: "ok" | "error", message?: string): void {
    try {
      this.span.setStatus({
        code: status === "ok" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
        message,
      });
    } catch {
      /* ignored, see above */
    }
  }

  /** Idempotent, per the port's contract — OTel warns on a double end. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    try {
      this.span.end();
    } catch {
      /* ignored, see above */
    }
  }

  get context(): TraceContext | null {
    return toTraceContext(this.span);
  }
}

function toTraceContext(span: OtelSpan | undefined): TraceContext | null {
  if (!span) return null;

  try {
    const spanContext = span.spanContext();
    // The all-zero trace id is OpenTelemetry's "invalid context" sentinel,
    // returned by the non-recording span you get when no provider is
    // registered. Reporting it as a correlation id would put a fake,
    // uniform value in every log line.
    if (!spanContext || !spanContext.traceId || /^0+$/.test(spanContext.traceId)) return null;

    return {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      correlationId: spanContext.traceId,
    };
  } catch {
    return null;
  }
}

/** Instrumentation scope name — how spans from this app's own manual
 *  instrumentation are grouped, and told apart from Next.js's built-in
 *  `next.js` scope in the collector. */
export const TRACER_SCOPE = "maestroya";

export class OtelTracer implements TracingPort {
  readonly enabled = true;

  private readonly tracer: OtelTracerApi;

  constructor(scope: string = TRACER_SCOPE) {
    this.tracer = trace.getTracer(scope);
  }

  startSpan(name: string, options?: SpanOptions): Span {
    try {
      const span = this.tracer.startSpan(
        name,
        { kind: SPAN_KINDS[options?.kind ?? "internal"], attributes: toOtelAttributes(options?.attributes) },
        this.parentContext(options),
      );
      return new OtelSpanAdapter(span);
    } catch {
      // A failure here means the SDK is broken, not the caller. Hand back
      // a span-shaped object that records nothing rather than propagating.
      return inertSpan();
    }
  }

  async withSpan<T>(name: string, fn: (span: Span) => T | Promise<T>, options?: SpanOptions): Promise<T> {
    let span: OtelSpan;
    let parent: Context;
    try {
      parent = this.parentContext(options);
      span = this.tracer.startSpan(
        name,
        { kind: SPAN_KINDS[options?.kind ?? "internal"], attributes: toOtelAttributes(options?.attributes) },
        parent,
      );
    } catch {
      // Span creation failed — still run the work, untraced. This is the
      // single most important line in the module: instrumentation is
      // never allowed to decide whether business logic executes.
      return fn(inertSpan());
    }

    const adapter = new OtelSpanAdapter(span);
    const active = trace.setSpan(parent, span);

    try {
      // `context.with` is what makes the span *ambient* for everything
      // `fn` calls (via AsyncLocalStorage — see `otel-sdk.ts`'s
      // `AsyncLocalStorageContextManager` registration), which is how a
      // Prisma query five frames deep ends up a child of the request span
      // without any argument passing.
      const result = await otelContext.with(active, () => fn(adapter));
      // Deliberately not `setStatus("ok")`: OpenTelemetry treats `UNSET`
      // as "no explicit judgement", which lets a backend apply its own
      // error heuristics (e.g. HTTP 5xx). Callers that genuinely know the
      // outcome — `withApiTracing` — set it themselves.
      return result;
    } catch (error) {
      adapter.recordException(error);
      adapter.setStatus("error", error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      adapter.end();
    }
  }

  currentSpan(): Span | null {
    const span = trace.getSpan(otelContext.active());
    return span ? new OtelSpanAdapter(span) : null;
  }

  currentContext(): TraceContext | null {
    return toTraceContext(trace.getSpan(otelContext.active()));
  }

  inject(carrier: TraceCarrier = {}): TraceCarrier {
    try {
      propagation.inject(otelContext.active(), carrier);
    } catch {
      /* an un-propagated trace is a broken trace, never a broken request */
    }
    return carrier;
  }

  /**
   * Resolves the context the new span hangs off: the remote context
   * carried in `options.parent` when one was supplied and is parseable,
   * otherwise whatever is ambient. An unparseable carrier falls through
   * to ambient rather than erroring — a truncated `traceparent` from an
   * upstream proxy should cost one broken link, not the request.
   */
  private parentContext(options: SpanOptions | undefined): Context {
    const active = otelContext.active();
    if (!options?.parent) return active;

    try {
      const extracted = propagation.extract(active, options.parent);
      return trace.getSpanContext(extracted) ? extracted : active;
    } catch {
      return active;
    }
  }
}

/**
 * A `Span` that records nothing, used only on the "OpenTelemetry itself
 * threw" paths above. Deliberately a fresh object rather than the port's
 * shared `nullSpan` so nothing can mutate a shared singleton.
 */
function inertSpan(): Span {
  return {
    setAttribute() {},
    setAttributes() {},
    addEvent() {},
    recordException() {},
    setStatus() {},
    end() {},
    context: null,
  };
}
