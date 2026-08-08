# Module 51 — Distributed Tracing

## 1. Goal

Give an operator one end-to-end timeline for a unit of work as it crosses
this platform's process/transport boundaries — an HTTP request that
enqueues a background job, publishes a domain event, queries Postgres,
calls Stripe/Resend/Twilio, and reads/writes the cache and search index —
without changing a single line of business logic, without becoming a
dependency any request can fail on, and without costing anything at all
when it is switched off (the default). It is built on OpenTelemetry, the
vendor-neutral standard every commercial and open-source trace backend
(Grafana Tempo, Jaeger, Honeycomb, Datadog, Sentry's own OTLP endpoint)
already speaks, so the platform never couples itself to one vendor's SDK
for what is, structurally, diagnostic data about work the platform already
did.

This is an infrastructure module: no domain entity, use case, or DTO in
the codebase changes shape because of it. Every integration point is
either a decorator over an existing port (`CacheProvider`,
`SearchIndexProvider`, `EventBus`, `EmailSender`,
`NotificationChannelAdapter`), an extension at an existing composition
point (the Prisma client singleton, the job lifecycle observer, the
Stripe/Twilio HTTP clients), or a thin wrapper around a Route Handler
(`withApiTracing`). Nothing above `infrastructure/tracing/` ever imports
`@opentelemetry/*`.

## 2. Architecture

### 2.1 Layering

```
application/ports/
  tracing.ts                    (TracingPort, Span, SpanOptions, TraceCarrier, TraceContext,
                                  nullTracer/nullSpan — the only vocabulary the rest of the
                                  platform is allowed to know about tracing)

application/services/tracing/
  tracing-service.ts             (TracingService — trace/traceExternalCall/traceProducer/
                                   traceConsumer, logContext(), correlationId() — for any
                                   application-layer caller that wants named helpers
                                   instead of the raw port)

infrastructure/tracing/
  otel-tracer.ts                 (OtelTracer — the TracingPort implementation, the only
                                   place besides otel-sdk.ts/the providers that imports
                                   @opentelemetry/api)
  otel-sdk.ts                    (boots and registers the Node SDK; only reachable via a
                                   dynamic import(), only when TRACING_ENABLED=true)
  tracing-config.ts              (resolveTracingConfig(), parseExporterHeaders() — turns the
                                   five validated env vars into one resolved TracingConfig)
  tracing-health.ts               (TracingHealthReport shape + collectTracingHealth())
  tracing-sentry.ts               (attachSentryTraceContext — stamps trace_id/span_id onto
                                   Sentry's scope; the only Module 39 integration point)
  trace-carrier.ts                (TraceCarrier <-> Headers/plain-record conversions — the
                                   one place that knows which header names propagate)
  compose.ts                      (composition root: getTracer()/getTracingService(),
                                   startTracing()/shutdownTracing(), getTracingHealth())
  providers/
    span-exporter-factory.ts      (createSpanExporter — console | otlp | none)
    resilient-span-exporter.ts    (ResilientSpanExporter — the circuit breaker, §6)
  http-tracing.ts                 (withApiTracing, setTracedUserId — the HTTP boundary)
  event-bus-tracing.ts            (TracedEventBus, withEventBusTracing)
  job-tracing.ts                  (TracingJobLifecycleObserver, withJobTracing)
  prisma-tracing.ts               (withPrismaTracing — a $extends hook over the Prisma client)
  traced-cache-provider.ts        (TracedCacheProvider, withCacheTracing)
  traced-search-provider.ts       (TracedSearchIndexProvider, withSearchTracing)
  traced-fetch.ts                 (createTracedFetch — outbound HTTP, used for Stripe/Twilio)
  traced-external-senders.ts      (TracedEmailSender, TracedNotificationChannel)
```

Application code depends only on `TracingPort`/`TracingService`. Every
`@opentelemetry/*` import in the codebase lives in exactly three files:
`otel-tracer.ts`, `otel-sdk.ts`, and the two files under
`infrastructure/tracing/providers/`.

### 2.2 Why a port, when `@opentelemetry/api` is already vendor-neutral

`@opentelemetry/api` is a vendor-neutral façade, but it is still a
specific vendor's façade: its own `Context`/`SpanContext`/
`SpanStatusCode`/`Attributes` vocabulary, its own global registration
model, `AsyncLocalStorage`-based context propagation. Depending on it
directly from a use case would put an infrastructure concern — *how*
telemetry is collected — into the layer whose entire job is not to care,
exactly the discipline `CacheProvider` (Module 46) and
`SearchIndexProvider` (Module 47) already establish for Redis and
Meilisearch/Typesense. The port also makes every test in this module
runnable against a plain fake (`tests/test-utils/fake-tracer.ts`) rather
than a live SDK — see §8.

### 2.3 Composition, never replacement

Every integration point is additive over something that already exists:

| Boundary | Seam used | File(s) changed |
|---|---|---|
| HTTP | Route Handler wrapper | 9 `route.ts` files (2 deliberately excluded — §3.1) |
| Event Bus | `EventBus` port decorator | `event-bus-factory.ts` |
| Background Jobs / Queue | `JobLifecycleObserver` decorator + `Queue`'s own `tracer` dependency | `jobs/compose.ts`, `jobs/queue.ts`, `jobs/job-types.ts` |
| Database | Prisma `$extends` at the client singleton | `database/prisma/client.ts` |
| Cache | `CacheProvider` port decorator | `cache/cache-provider-factory.ts` |
| Search | `SearchIndexProvider` port decorator | `search/search-provider-factory.ts` |
| Stripe | SDK's own pluggable `httpClient` | `payments/stripe/client.ts` |
| Twilio | `TwilioSmsSender`'s existing injectable `fetchImpl` | `sms/sms-sender-factory.ts` |
| Resend / Realtime gateway | `EmailSender` / `NotificationChannelAdapter` port decorators | `auth/compose.ts`, `notification-dispatcher.compose.ts` |

No repository, no use case, no domain entity, and no existing test for
any of those modules had to change to accommodate this — every decorator
implements the *unmodified* interface the platform already depended on.

## 3. Flow

### 3.1 HTTP

`withApiTracing(route, handler)` wraps a Route Handler so the whole
request becomes one `server` span; everything the handler touches
(Prisma, cache, search, an enqueued job, a published event, an outbound
`fetch`) becomes a child of it automatically via OpenTelemetry's ambient
(`AsyncLocalStorage`-backed) context. It captures method, route (the
*pattern*, never a resolved id — low cardinality, matching OpenTelemetry's
own HTTP semantic conventions), status, duration, this codebase's own
request id, and — via `setTracedUserId` — the authenticated user, for the
handlers that already resolve a session.

This is deliberately **not** done in `middleware.ts`: middleware's
`matcher` excludes `/api/*` entirely (by design, to keep asset/API traffic
off the middleware path) and runs on the Edge runtime, where the Node SDK,
`AsyncLocalStorage` and Prisma do not exist. Anchoring the span in the
Route Handler itself is what lets it become the parent of Node-runtime
work.

Once `startTracing()` has registered a provider, Next.js 15 also emits its
own `next.js`-scoped spans for every route (page and API) automatically,
with no code change — `withApiTracing` is additive to that, not a
replacement for it.

`/api/health` and `/api/health/ready` are deliberately left unwrapped: an
orchestrator polls both every few seconds forever, and tracing a
liveness/readiness probe would produce a constant stream of spans
describing no user-visible work. `/api/auth/[...nextauth]` (Auth.js's own
catch-all) is likewise left to that library's own internals.

Resolution order: `withApiTracing` reads `getTracer()` **once, at module
load** (when the route file is imported), not per request — see §5 for
why that matters for the disabled path.

### 3.2 Event Bus

`TracedEventBus` decorates the process's single `EventBus` (whichever of
`SynchronousEventBus`/`QueuedEventBus` `EVENT_QUEUE_ENABLED` selected) and
opens two kinds of span: one `producer` span around `publish()`
(`event.publish <name>`, capturing outcome and duration), and one
`internal` span per individual handler invocation
(`event.handle <name> <Handler>`), added by wrapping the handler at
`subscribe()` time. Per-handler spans are what make a slow fan-out
legible — with one span per event you can see a publish took 400ms; with
one per handler you can see 380ms of it was one particular subscriber.
Failure semantics are byte-for-byte preserved: a handler's exception is
recorded on its span and re-thrown unchanged, so `EventDispatchError` and
`handlerName` are exactly what they were before this module existed.

### 3.3 Background Jobs / Queue

Instrumented through the job runtime's existing `JobLifecycleObserver`
seam (Module 45), not by editing `Queue`/`Worker`. `TracingJobLifecycleObserver`
wraps the existing logger/Sentry observer — calling it first,
unconditionally, on every hook — and adds:

- **`queue.enqueue <queue>`** (`producer`, instantaneous) at `onQueued`,
  tagged with the queue name, job name and delay.
- **`job.process <queue>`** (`consumer`) opened at `onActive`, held open
  in a `Map<jobId, …>` until whichever terminal hook fires
  (`onCompleted`/`onRetried`/`onFailed`/`onSkippedAsDuplicate`), carrying
  processing duration, attempt number and outcome. A retry records the
  exception but does **not** set an error status — a scheduled retry is
  the system working as designed, and marking it an error would pollute
  the backend's error rate with every self-healing blip; a genuinely
  exhausted/dead-lettered job does set one.

The producer→consumer link is what makes an enqueue and the (possibly
much later, possibly different-process) worker execution one trace:
`Queue.add` (via its own `tracer` dependency, defaulted to `nullTracer`)
captures the active trace context into a new, optional `StoredJob.trace`
field — a flat string map, JSON-safe, absent entirely unless tracing is
on — and `onActive` parents the `job.process` span to it.

### 3.4 Database

`withPrismaTracing` extends the Prisma client singleton once, at
`database/prisma/client.ts`, via `$extends`'s `$allOperations` hook —
underneath all 40+ repositories, `$queryRaw`, `$transaction` and the
Auth.js Prisma adapter alike, none of which had to change. Only the
operation and model name are recorded (`prisma.User.findMany`), never
`args` — query arguments routinely carry emails, phone numbers and
tokens, and an exported span is exactly as sensitive a destination as a
log line.

### 3.5 External services

Stripe and Twilio are instrumented at their own HTTP-client seams
(`Stripe.createFetchHttpClient`, `TwilioSmsSender`'s injectable
`fetchImpl`) via `createTracedFetch(system)`, which both opens a `client`
span **and** injects W3C trace-context headers into the outbound request
— the one instrumentation point that also extends the trace past this
platform's boundary into a collector-instrumented downstream service.
Resend and the realtime gateway are instrumented one layer up, as
port decorators (`TracedEmailSender`, `TracedNotificationChannel`), since
neither exposes an injectable HTTP client the same way. The cache and
search engine are instrumented as their own port decorators
(`TracedCacheProvider`, `TracedSearchIndexProvider`).

### 3.6 Trace propagation, end to end

| Hop | Carried via |
|---|---|
| HTTP → this process | `traceparent`/`tracestate` request headers, extracted in `withApiTracing` |
| This process → Postgres/Stripe/Resend/Twilio/search/cache | Ambient (`AsyncLocalStorage`) context; Stripe/Twilio additionally get outbound headers via `createTracedFetch` |
| HTTP/use case → enqueued job | `Queue.add` captures the carrier into `StoredJob.trace` |
| Enqueued job → worker execution | `TracingJobLifecycleObserver.onActive` parents to `StoredJob.trace` |
| Publish → event handler | Ambient context (same process, same call stack) |
| This process → downstream HTTP service | `createTracedFetch` injects `traceparent`/`tracestate` |

Every hop uses the identical W3C Trace Context carrier shape
(`TraceCarrier`, `infrastructure/tracing/trace-carrier.ts`) — a flat
string map — so `inject`/`extract` is the same two functions everywhere,
with no per-transport format. An absent or unparseable carrier is always
treated as "start a fresh trace", never an error.

## 4. Ports

`application/ports/tracing.ts` defines the entire surface application code
may depend on:

- `TracingPort` — `enabled`, `startSpan`, `withSpan`, `currentSpan`,
  `currentContext`, `inject`. Every member is total: an implementation
  must never throw, and `withSpan` must resolve/reject with exactly what
  the wrapped function does.
- `Span` — `setAttribute(s)`, `addEvent`, `recordException`, `setStatus`,
  `end` (idempotent), `context`.
- `SpanKind` — `internal | server | client | producer | consumer`, a
  plain string union so no caller imports OpenTelemetry's enum.
- `TraceCarrier` — the flat string map trace context travels in across
  every hop.
- `nullTracer`/`nullSpan` — the shared, allocation-free implementation
  every process gets when tracing is disabled.

`application/services/tracing/tracing-service.ts` (`TracingService`) is
the thin, optional application-layer face over the port: `trace()`,
`traceExternalCall()`, `traceProducer()`, `traceConsumer()`,
`logContext()`, `correlationId()`. It exists so that span-naming and
attribute-key conventions (`external.system`, `messaging.destination.name`,
`<component>.<operation>`) are enforced in one place rather than invented
ad hoc at each of this module's nine integration points.

## 5. Infrastructure

`OtelTracer` (`otel-tracer.ts`) is the `TracingPort` implementation. It
imports `@opentelemetry/api` **statically** — the API package is a
side-effect-free façade until a provider is registered, so this is safe
and cheap even when tracing is off — but never constructs the actual SDK
itself; that only happens through `otel-sdk.ts`'s dynamic `import()`,
called from `compose.ts`'s `startTracing()`, and only when
`TRACING_ENABLED=true`. This is the identical pattern
`sentry-client.ts` (Module 39) uses for `@sentry/nextjs`.

`otel-sdk.ts` registers a `NodeTracerProvider` with a
`W3CTraceContextPropagator` and, when an exporter is selected, a
`BatchSpanProcessor` (never `SimpleSpanProcessor` — batching keeps
collector latency off the request path). Registering globally is also
what turns on Next.js 15's own built-in per-request tracing across the
entire app.

Deliberately **not** `@opentelemetry/sdk-node` + `auto-instrumentations-node`:
that combination monkey-patches `require()` (`require-in-the-middle`),
which is fragile inside a bundled Next.js server build, and would pull
~20 unused instrumentation packages (MongoDB, Kafka, GraphQL, ...) into
the dependency tree. Every integration point this module needs already
has a first-class seam in this codebase — a port, a factory, an observer,
a Prisma extension — so instrumenting them explicitly is both smaller and
more precise.

`compose.ts` is the composition root, following the exact
module-level-singleton, `__testing.reset()`, no-DI-container convention
every other `compose.ts` in the codebase uses:

- `getTracer()` — the one process-wide `TracingPort`. `nullTracer` when
  disabled; an `OtelTracer` otherwise.
- `getTracingService()` — `TracingService` over `getTracer()`.
- `startTracing()`/`shutdownTracing()` — called from `instrumentation.ts`'s
  existing boot hook and SIGTERM/SIGINT handler; no new signal handlers.
- `getTracingHealth()` — consumed by `/api/health/ready`.

Every one of the nine composition-root call sites listed in §2.3 resolves
its `enabled`/`disabled` decision **once**, at wrap/construction time
(module load), not per call — the same discipline `withApiTracing`
follows (§3.1). This is what makes "zero overhead when disabled" apply to
every hot path uniformly, not just the ones that happen to check first.

## 6. Failure recovery

Tracing must never fail a request. Three independent layers enforce that:

1. **`OtelTracer` is total by construction.** Every method is wrapped in
   a `try`/`catch`; a failure inside OpenTelemetry (a broken SDK, an
   internal exception) degrades to an inert, non-recording span rather
   than propagating. `withSpan` in particular still runs the wrapped
   function on the "span creation itself failed" path — instrumentation
   never decides whether business logic executes.
2. **`startTracing()` never throws.** If the SDK fails to start (a
   missing/broken install, a misconfigured exporter), the failure is
   logged once and recorded for `checks.tracing`; the process continues
   with a tracer whose spans are simply never exported.
3. **`ResilientSpanExporter` is the exporter's own circuit breaker.**
   OpenTelemetry's `BatchSpanProcessor` already keeps request-path
   latency off the export path and already swallows export errors — what
   it does not do is stop trying, so an unreachable collector would
   otherwise retry an HTTP POST forever. `ResilientSpanExporter` counts
   consecutive failures, logs the first one at `warn`, and after
   `DEFAULT_EXPORT_FAILURE_THRESHOLD` (5) consecutive failures disables
   itself for the process's lifetime — later spans are dropped locally
   and reported as `SUCCESS` upstream so nothing queues up. A single
   success at any point resets the counter, so a collector that comes
   back from a brief blip is used again with no restart. Dropping spans
   is the correct trade here: traces are diagnostic data about work the
   platform already did, never load-bearing.

`checks.tracing` on `/api/health/ready` reports `disabled` (the healthy
default), `ok`, or `degraded` (SDK failed to start, or the exporter
tripped its breaker) — and, matching every other check on that route,
never changes the response's overall status or HTTP code. An instance
whose collector is unreachable serves every page, booking and payment
identically; the only thing lost is the operator's own view.

## 7. Configuration

| Variable | Default | Notes |
|---|---|---|
| `TRACING_ENABLED` | unset (disabled) | Opt-in `"true"`/`"false"`. Unlike `SEARCH_INDEXING_ENABLED`/`ANALYTICS_REFRESH_ENABLED` (opt-out — their default backend is local and the app itself consumes the output), tracing's useful default backend is an external collector consumed by an operator, not the platform — nothing degrades when it's off. |
| `TRACING_EXPORTER` | `console` | `console` \| `otlp` \| `none`. Falls back to `console` (never fails startup) for an invalid value, the same convention `SEARCH_PROVIDER`/`SMS_PROVIDER`/`GEOCODING_PROVIDER` use. |
| `OTEL_SERVICE_NAME` | `maestroya-platform` | `service.name` on every exported span. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | Required only when `TRACING_EXPORTER=otlp`. `otlp` selected with no endpoint downgrades to `none` at the config layer rather than building a doomed exporter. |
| `OTEL_EXPORTER_HEADERS` | unset | Comma-separated `key=value` pairs (OpenTelemetry's own `OTEL_EXPORTER_OTLP_HEADERS` grammar) sent as OTLP request headers — a collector's auth token, a tenant id. Parsed leniently; a malformed pair is skipped, never fatal. |

Production hardening (`env.ts`'s `.superRefine`): a production deployment
with `TRACING_ENABLED=true` **and** `TRACING_EXPORTER=otlp` must set
`OTEL_EXPORTER_OTLP_ENDPOINT`, or startup fails — the same "a deliberately
selected backend must not silently export nothing" rule `SMS_PROVIDER=twilio`
and `SENTRY_DSN` already enforce for their own modules. Tracing left
disabled is never itself a production requirement; unlike error
reporting, an untraced deployment is unobservable in one dimension, not
unmonitored.

## 8. Testing

- **Unit — the port and its null object**
  (`tests/unit/core/application/ports/tracing.test.ts`): `nullTracer`/
  `nullSpan` are safe no-ops, and `withSpan` still runs/returns/throws
  exactly what the wrapped function does.
- **Unit — `TracingService`**
  (`tests/unit/core/application/services/tracing/`): every helper against
  both `nullTracer` and a fake tracer.
- **Unit — every decorator/observer**
  (`tests/unit/core/infrastructure/tracing/`): `event-bus-tracing`,
  `job-tracing`, `traced-cache-provider`, `traced-search-provider`,
  `traced-fetch`, `traced-external-senders`, `http-tracing`, all written
  against `tests/test-utils/fake-tracer.ts` — a `TracingPort` fake with no
  `@opentelemetry/*` involved, so these tests assert on the decorator's
  own logic (span names, attributes, parent linkage, disabled-path
  no-ops) independent of the SDK.
- **Unit — configuration and health**: `tracing-config.test.ts`
  (`resolveTracingConfig`, `parseExporterHeaders`), `tracing-health.test.ts`
  (`collectTracingHealth`), `providers/resilient-span-exporter.test.ts`
  (the circuit breaker — consecutive failures, disablement, recovery,
  synchronous-throw safety), `compose.test.ts` (disabled mode never
  imports `otel-sdk.ts`; enabled mode boots/degrades/shuts down
  correctly; `startTracing()` is idempotent under concurrent calls).
- **Unit — env**: `env.test.ts`'s "Module 51" suite covers defaults,
  invalid-value fallback, and the production `OTEL_EXPORTER_OTLP_ENDPOINT`
  hardening rule.
- **Integration — real propagation**
  (`tests/integration/tracing/trace-propagation.test.ts`): the one suite
  that registers a real `NodeTracerProvider` with an `InMemorySpanExporter`
  (no network, no collector) and asserts on actual OpenTelemetry span
  records — that an HTTP request span, an enqueued job's `StoredJob.trace`,
  the later `job.process` span, an event publish/handle pair, and an
  outbound traced `fetch` all share one `traceId` with correct
  parent/child `spanId` links, and that a carrier round-trips through
  `JSON.stringify`/`parse` (the exact path `RedisJobStore` puts it
  through) unchanged.
- **Integration — health route**
  (`tests/integration/observability/health-routes.test.ts`): `checks.tracing`
  reports `disabled` by default and `ok` once `TRACING_ENABLED=true` and
  the (mocked) SDK has started, in both cases without affecting the
  route's overall status or HTTP code.
