/**
 * Module 51 — Distributed Tracing.
 *
 * The single abstraction the rest of the platform is allowed to know
 * about tracing. Nothing above `infrastructure/tracing/` ever imports
 * `@opentelemetry/*` — exactly the same rule `CacheProvider` (Module 46),
 * `SearchIndexProvider` (Module 47) and `JobStore` (Module 45) already
 * establish for Redis, Meilisearch/Typesense and BullMQ respectively.
 *
 * ## Why a port at all, when OpenTelemetry already *is* an API package
 * `@opentelemetry/api` is a vendor-neutral façade, but it is still a
 * specific vendor's façade: it brings its own `Context`/`SpanContext`/
 * `SpanStatusCode`/`Attributes` vocabulary, its own global registration
 * model, and (in the Node SDK) `AsyncLocalStorage` semantics. Depending
 * on it directly from a use case would put an infrastructure concern —
 * *how* telemetry is collected — into the layer whose entire job is not
 * to care. This port keeps the application layer expressing only *what*
 * is worth observing (an operation, its attributes, whether it failed),
 * which is also what makes every tracing-related unit test in this module
 * runnable against a plain fake rather than a live SDK.
 *
 * ## Never a source of failure
 * Every member below is specified as total: an implementation must never
 * throw, and `withSpan` must never change the observable result of the
 * function it wraps (same value, same rejection, same rejection reason).
 * Tracing that can break a request is worse than no tracing at all — the
 * same contract `CacheProvider.get` ("a cache is never allowed to be the
 * reason a request fails") and `SearchIndexProvider.ping` ("never
 * throws") already state for their own layers.
 */

/**
 * Mirrors OpenTelemetry's `SpanKind`, as a plain string union so callers
 * never import the SDK's enum. `internal` is the default.
 *
 *  - `server`   — an inbound request this process is handling (HTTP).
 *  - `client`   — an outbound call to something else (Postgres, Stripe,
 *                 Resend, Twilio, the search engine, Redis, any `fetch`).
 *  - `producer` — work handed to an asynchronous transport (enqueue,
 *                 publishing a domain event onto the queued bus).
 *  - `consumer` — work picked back up off that transport (a worker
 *                 running a job, a queued event handler).
 */
export type SpanKind = "internal" | "server" | "client" | "producer" | "consumer";

/** The value types a span attribute may hold. `undefined` entries are dropped. */
export type SpanAttributeValue = string | number | boolean;

export type SpanAttributes = Record<string, SpanAttributeValue | null | undefined>;

/**
 * A propagation carrier — a flat string map, which is what both HTTP
 * headers and a JSON job payload already are. This is deliberately the
 * *only* shape trace context ever travels in across a process boundary,
 * so the same `inject`/`extract` pair serves HTTP → queue → worker →
 * event handler → realtime with no format per hop. The keys are the W3C
 * Trace Context ones (`traceparent`, `tracestate`); no caller should ever
 * need to know that.
 */
export type TraceCarrier = Record<string, string>;

export interface TraceContext {
  traceId: string;
  spanId: string;
  /**
   * The platform-wide correlation id for the current unit of work. Equal
   * to `traceId` whenever a trace is active — one id in the logs, in the
   * span, and in Sentry — so an operator never has to join two different
   * identifier spaces. `middleware.ts`'s `x-request-id` (Module 25)
   * remains the correlation id when tracing is disabled; see
   * `infrastructure/tracing/http-tracing.ts` for where the two are tied
   * together.
   */
  correlationId: string;
}

export interface Span {
  setAttribute(key: string, value: SpanAttributeValue | null | undefined): void;
  setAttributes(attributes: SpanAttributes): void;
  /** A timestamped point inside the span (a retry, a dead-letter, a cache miss). */
  addEvent(name: string, attributes?: SpanAttributes): void;
  /** Records `error` on the span. Does **not** end the span or set its status. */
  recordException(error: unknown): void;
  setStatus(status: "ok" | "error", message?: string): void;
  /** Idempotent — ending an already-ended span is a no-op, never an error. */
  end(): void;
  /** `null` for a non-recording span (tracing disabled, or not sampled). */
  readonly context: TraceContext | null;
}

export interface SpanOptions {
  kind?: SpanKind;
  attributes?: SpanAttributes;
  /**
   * Continues a trace started in another process/hop. When present and
   * parseable, the new span is a child of the context this carrier
   * encodes rather than of whatever is ambient locally — this is what
   * makes HTTP → queue → worker one trace instead of three.
   */
  parent?: TraceCarrier | null;
}

/**
 * The tracing capability itself. One process-wide implementation, chosen
 * in `infrastructure/tracing/compose.ts` (`nullTracer` when
 * `TRACING_ENABLED` is not `"true"`).
 */
export interface TracingPort {
  /**
   * Whether spans this tracer creates can actually be recorded and
   * exported. `false` for `nullTracer`. Call sites use it to skip
   * building attribute objects at all on the disabled path — the "zero
   * overhead when off" guarantee is cheap to keep, but only if hot paths
   * check first.
   */
  readonly enabled: boolean;

  /**
   * Starts a span **without** making it the active context. Callers are
   * responsible for `end()`ing it, including on the failure path — prefer
   * `withSpan` unless the start and end genuinely happen in different
   * callbacks (the `JobLifecycleObserver` integration is the one place in
   * this codebase that does).
   */
  startSpan(name: string, options?: SpanOptions): Span;

  /**
   * Runs `fn` inside a new span that is the active context for its whole
   * (async) execution, then ends the span.
   *
   * Contract: resolves with exactly what `fn` returns and rejects with
   * exactly what `fn` throws. A thrown error is recorded on the span and
   * the status set to `error` before it is re-thrown — observing a
   * failure never swallows it.
   */
  withSpan<T>(name: string, fn: (span: Span) => T | Promise<T>, options?: SpanOptions): Promise<T>;

  /** The currently active span, or `null` when nothing is active/recording. */
  currentSpan(): Span | null;

  /** The active trace/correlation identity, or `null`. */
  currentContext(): TraceContext | null;

  /**
   * Writes the active trace context into `carrier` (a new object when
   * omitted) and returns it. An empty result means "nothing active to
   * propagate", which every `extract`/`parent` consumer treats as "start
   * a fresh trace" rather than an error.
   */
  inject(carrier?: TraceCarrier): TraceCarrier;
}

/** A span that records nothing. Shared, immutable, allocation-free. */
export const nullSpan: Span = {
  setAttribute() {},
  setAttributes() {},
  addEvent() {},
  recordException() {},
  setStatus() {},
  end() {},
  context: null,
};

/**
 * Null object — the implementation every process gets when tracing is
 * disabled, and the default for any constructor that takes an optional
 * tracer. Same "null object beats an optional callback" convention as
 * `nullJobLifecycleObserver` (Module 45), `nullSearchObserver` (Module
 * 47) and `nullAnalyticsObserver` (Module 50).
 *
 * `withSpan` still awaits and returns `fn`'s result, so wrapping code
 * behaves identically whether or not tracing is on — the only difference
 * is that nothing is recorded.
 */
export const nullTracer: TracingPort = {
  enabled: false,
  startSpan: () => nullSpan,
  withSpan: async (_name, fn) => fn(nullSpan),
  currentSpan: () => null,
  currentContext: () => null,
  inject: (carrier) => carrier ?? {},
};
