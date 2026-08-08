import "server-only";

import type { NextRequest } from "next/server";

import { logger } from "@/infrastructure/observability/logger";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";
import { getTracer } from "@/infrastructure/tracing/compose";
import { carrierFromHeaders } from "@/infrastructure/tracing/trace-carrier";
import { attachSentryTraceContext } from "@/infrastructure/tracing/tracing-sentry";

/**
 * Module 51 — Distributed Tracing — the HTTP boundary.
 *
 * `withApiTracing` decorates a Route Handler so that the whole request is
 * one `server` span, and everything the handler touches — Prisma queries,
 * the cache, the search engine, an enqueued job, a published domain
 * event, an outbound `fetch` — becomes a child of it automatically, via
 * the ambient context `TracingPort.withSpan` establishes.
 *
 * ## Why a wrapper here, and not `middleware.ts`
 * `middleware.ts` looks like the obvious place (it already resolves the
 * request id for every request), and it is the wrong one, for two
 * independent reasons:
 *
 *  1. **It does not run for API routes at all.** Its `matcher` is
 *     `"/((?!api|_next/static|_next/image|favicon.ico).*)"` — `/api/*` is
 *     explicitly excluded, by design, so that middleware does not add
 *     latency to asset and API traffic.
 *  2. **It runs on the Edge runtime**, where the Node SDK,
 *     `AsyncLocalStorage`-based context propagation, and Prisma do not
 *     exist. A span opened there could not become the parent of anything
 *     the Node-runtime handler does, which is the entire point.
 *
 * Middleware is therefore left completely untouched, and the trace is
 * anchored where the work actually happens. Trace context still arrives
 * end-to-end: an upstream `traceparent` header is read straight off the
 * request here, exactly as `resolveRequestId` reads `x-request-id`.
 *
 * ## This is additive to Next.js's own spans, not a replacement
 * Once `startTracing()` has registered a provider, Next.js 15 emits its
 * own `next.js`-scoped spans for request handling and rendering across
 * *every* route (page and API), with no code change at all — that is the
 * "auto-trace every request" half. This wrapper adds the half Next.js
 * structurally cannot provide: this codebase's `x-request-id`, the
 * authenticated user, and a status/duration attribution that survives a
 * handler which catches its own errors and returns a 4xx/5xx response
 * rather than throwing.
 *
 * ## The two routes deliberately left unwrapped
 * `/api/health` (liveness) and `/api/health/ready` (readiness) are not
 * traced. A container orchestrator runs both every few seconds forever,
 * so tracing them would produce a constant stream of spans that describe
 * no user-visible work, keep an otherwise idle exporter permanently
 * busy, and dominate any sampled trace budget. This is the same
 * judgement `TracedSearchIndexProvider` makes in not tracing `ping()`,
 * and it is why the liveness route keeps its documented "zero
 * dependencies" property intact.
 *
 * ## Never changes handler behaviour
 * When tracing is disabled the original handler function is returned
 * *as-is* — not wrapped, so there is not even an extra call frame. When
 * enabled, the handler's response is returned unmodified and its
 * exceptions are re-thrown unchanged after being recorded.
 */

type RouteHandler<TArgs extends unknown[], TResponse extends Response> = (
  request: NextRequest,
  ...args: TArgs
) => Promise<TResponse>;

export function withApiTracing<TArgs extends unknown[], TResponse extends Response>(
  route: string,
  handler: RouteHandler<TArgs, TResponse>,
): RouteHandler<TArgs, TResponse> {
  // Resolved once, at wrap time (module load), not per request: `getTracer()`
  // returns the same process-wide singleton for the whole life of the
  // process (see `compose.ts`), so re-checking `tracer.enabled` on every
  // request would only add a branch and a `getTracer()` call for no
  // behavioural difference. When disabled, `handler` itself is returned —
  // not a closure that calls it — so a disabled route has *no* wrapper
  // call frame at all, matching every other decorator in this module
  // (`withCacheTracing`, `withSearchTracing`, `withEventBusTracing`, ...),
  // all of which make this same enabled/disabled decision once, at
  // composition time, rather than on every call.
  const tracer = getTracer();
  if (!tracer.enabled) return handler;

  return async (request: NextRequest, ...args: TArgs): Promise<TResponse> => {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    const startedAt = Date.now();

    return tracer.withSpan(
      // `METHOD /route` is OpenTelemetry's own recommended span name for
      // a server span — low cardinality (the *route pattern*, never the
      // resolved path with its ids in it), which is what makes latency
      // aggregation per endpoint possible.
      `${request.method} ${route}`,
      async (span) => {
        span.setAttributes({
          "http.request.method": request.method,
          "http.route": route,
          "url.path": safePathname(request),
          // Module 25's correlation id, carried onto the span so a
          // support ticket quoting a request id resolves to a trace.
          "maestroya.request_id": requestId,
        });

        // Module 39 correlation — see `tracing-sentry.ts`.
        attachSentryTraceContext(span.context);

        try {
          const response = await handler(request, ...args);

          span.setAttributes({
            "http.response.status_code": response.status,
            "http.server.request.duration_ms": Date.now() - startedAt,
          });
          // Only 5xx is the *server's* error. A 401/404/409 is this
          // platform working correctly (see `toHttpErrorResponse`'s own
          // DomainError mapping) and must not pollute the error rate.
          if (response.status >= 500) span.setStatus("error", `HTTP ${response.status}`);

          logger.debug("http_request_traced", {
            requestId,
            route,
            method: request.method,
            status: response.status,
            durationMs: Date.now() - startedAt,
            traceId: span.context?.traceId,
          });

          return response;
        } catch (error) {
          // Recorded here so the span carries the failure even though the
          // exception continues to propagate untouched to Next.js's own
          // `onRequestError` hook, which remains the reporting path.
          span.setAttribute("http.server.request.duration_ms", Date.now() - startedAt);
          throw error;
        }
      },
      { kind: "server", parent: carrierFromHeaders(request.headers) },
    );
  };
}

/**
 * Records the authenticated user on the active request span. Called by
 * the handful of Route Handlers that resolve a session anyway.
 *
 * Deliberately *not* done inside `withApiTracing`: resolving the session
 * there would mean an extra JWT decode (and, for some flows, a database
 * read) on every request purely for telemetry — paying real latency for
 * an attribute. Handlers that already know who the caller is add it in
 * one line; handlers that do not, do not pay for it.
 */
export function setTracedUserId(userId: string | null | undefined): void {
  if (!userId) return;
  getTracer().currentSpan()?.setAttribute("enduser.id", userId);
}

function safePathname(request: NextRequest): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "unknown";
  }
}
