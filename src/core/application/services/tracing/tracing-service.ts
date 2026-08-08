import type {
  Span,
  SpanAttributes,
  TraceCarrier,
  TraceContext,
  TracingPort,
} from "@/application/ports/tracing";

/**
 * Module 51 — Distributed Tracing.
 *
 * The application-layer face of tracing: a thin service over
 * `TracingPort` that names the handful of *shapes* of traced operation
 * this platform actually has, so that neither a use case nor an
 * infrastructure adapter has to remember the span-kind and
 * attribute-naming conventions each time.
 *
 * Same layering as `CacheManager` over `CacheProvider` (Module 46) and
 * `AnalyticsDashboardAssembler` over its repositories (Module 50):
 * depends on nothing but ports, constructor-injected, no framework, no
 * `@opentelemetry/*`, fully unit-testable against a fake tracer.
 *
 * ## Why the wrapper methods exist rather than raw `withSpan` everywhere
 * Span names and attribute keys are the schema an operator queries. If
 * every call site invents its own (`"stripe call"` vs `"stripe.charge"`
 * vs `"external:stripe"`), the traces are unusable in aggregate no
 * matter how correct each one is individually. Routing every call
 * through four named helpers is what keeps `external.system`,
 * `messaging.destination.name`, and the `<component>.<operation>` naming
 * consistent across nine integration points written at different times.
 *
 * Every method is total: it returns exactly what the wrapped function
 * returns, throws exactly what it throws, and does nothing observable
 * when the injected tracer is `nullTracer`.
 */
export class TracingService {
  constructor(private readonly tracer: TracingPort) {}

  /** Whether spans are actually being recorded. Hot paths check first. */
  get enabled(): boolean {
    return this.tracer.enabled;
  }

  /**
   * A unit of in-process work — a use case, a projection, an assembler.
   * `kind: internal`.
   */
  async trace<T>(
    component: string,
    operation: string,
    fn: (span: Span) => T | Promise<T>,
    attributes?: SpanAttributes,
  ): Promise<T> {
    return this.tracer.withSpan(`${component}.${operation}`, fn, { kind: "internal", attributes });
  }

  /**
   * A call leaving this process: Postgres, Stripe, Resend, Twilio, the
   * search engine, Redis, any `fetch`. `kind: client`, tagged with
   * `external.system` so every third-party dependency can be summed,
   * ranked and alerted on as one dimension in the backend regardless of
   * which module issued the call.
   */
  async traceExternalCall<T>(
    system: string,
    operation: string,
    fn: (span: Span) => T | Promise<T>,
    attributes?: SpanAttributes,
  ): Promise<T> {
    return this.tracer.withSpan(`${system}.${operation}`, fn, {
      kind: "client",
      attributes: { "external.system": system, "external.operation": operation, ...attributes },
    });
  }

  /**
   * Handing work to an asynchronous transport (enqueue, publish).
   * `kind: producer`.
   *
   * The callback receives the span *and* a carrier that already holds the
   * new span's trace context — writing that carrier into the message is
   * what makes the eventual consumer a child of this span rather than the
   * root of an unrelated trace. Producers that cannot carry a payload
   * simply ignore it.
   */
  async traceProducer<T>(
    name: string,
    fn: (carrier: TraceCarrier, span: Span) => T | Promise<T>,
    attributes?: SpanAttributes,
  ): Promise<T> {
    return this.tracer.withSpan(name, (span) => fn(this.tracer.inject(), span), {
      kind: "producer",
      attributes,
    });
  }

  /**
   * Picking work back up off that transport (a worker running a job, a
   * queued event handler). `kind: consumer`, parented to `carrier` —
   * this and `traceProducer` are the two halves of every asynchronous
   * hop in the platform.
   */
  async traceConsumer<T>(
    name: string,
    carrier: TraceCarrier | null | undefined,
    fn: (span: Span) => T | Promise<T>,
    attributes?: SpanAttributes,
  ): Promise<T> {
    return this.tracer.withSpan(name, fn, { kind: "consumer", attributes, parent: carrier ?? null });
  }

  /** The active trace identity, or `null`. */
  currentContext(): TraceContext | null {
    return this.tracer.currentContext();
  }

  /**
   * The platform-wide correlation id for the current unit of work, or
   * `null` when there is no active trace. Callers pair this with Module
   * 25's `x-request-id` (see `http-tracing.ts`), never instead of it.
   */
  correlationId(): string | null {
    return this.tracer.currentContext()?.correlationId ?? null;
  }

  /**
   * Trace fields to merge into a `logger.*` call's metadata, so a log
   * line and the span it happened inside can be joined in either
   * direction. Returns `{}` when nothing is active, which spreads
   * harmlessly — a caller never needs a conditional.
   *
   * Deliberately a *pull* from the log call site rather than tracing
   * pushing itself into `logger.ts`: Module 25's logger must keep working
   * (and keep being importable from the Edge runtime, and from
   * `env.ts`-adjacent startup code) with no knowledge of this module, and
   * a logger that imported the tracer would invert the dependency this
   * whole module is built to avoid.
   */
  logContext(): { traceId?: string; spanId?: string; correlationId?: string } {
    const context = this.tracer.currentContext();
    if (!context) return {};

    return { traceId: context.traceId, spanId: context.spanId, correlationId: context.correlationId };
  }

  /** Adds attributes to whatever span is currently active. No-op if none. */
  annotate(attributes: SpanAttributes): void {
    this.tracer.currentSpan()?.setAttributes(attributes);
  }

  /** Writes the active trace context into a carrier for an outbound hop. */
  inject(carrier?: TraceCarrier): TraceCarrier {
    return this.tracer.inject(carrier);
  }
}
