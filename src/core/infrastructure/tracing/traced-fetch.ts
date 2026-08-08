import "server-only";

import type { TracingPort } from "@/application/ports/tracing";
import { getTracer } from "@/infrastructure/tracing/compose";
import { applyCarrierToHeaders } from "@/infrastructure/tracing/trace-carrier";

/**
 * Module 51 — Distributed Tracing — outbound HTTP.
 *
 * `createTracedFetch(system)` returns a drop-in `fetch` that opens a
 * `client` span around the call **and injects W3C trace context into the
 * outgoing request headers**. The second half is what extends a trace
 * past this platform's own boundary: a downstream service that also
 * speaks OpenTelemetry (a collector-instrumented internal service, the
 * realtime gateway, a partner API) joins the same trace instead of
 * starting its own.
 *
 * ## Why a factory rather than patching global `fetch`
 * Monkey-patching `globalThis.fetch` would instrument every call in the
 * process, including Next.js's own internal data fetching and — much
 * worse — would send `traceparent` to arbitrary third parties that never
 * asked for it, on requests this codebase does not control. An explicit,
 * injected `fetch` keeps propagation to the endpoints a composition root
 * deliberately opted in (`sms-sender-factory.ts` for Twilio, the Stripe
 * client's HTTP client), which is the same "no outbound call can happen
 * unless deliberately and completely configured" posture `env.ts`
 * documents for the geocoding providers.
 *
 * `TwilioSmsSender` already takes an injectable `fetchImpl` "for tests" —
 * that existing seam is exactly what this plugs into, with no change to
 * the sender itself.
 *
 * Never changes the call's behaviour: same arguments, same `Response`,
 * same rejection. When tracing is disabled the *original* `fetch` is
 * returned, so there is no wrapper frame at all.
 */
export function createTracedFetch(
  system: string,
  fetchImpl: typeof fetch = fetch,
  tracer: TracingPort = getTracer(),
): typeof fetch {
  if (!tracer.enabled) return fetchImpl;

  const traced: typeof fetch = async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = requestUrl(input);

    return tracer.withSpan(
      `HTTP ${method}`,
      async (span) => {
        // Injected *inside* the span so the child sees this span as its
        // parent — injecting before `withSpan` would propagate whatever
        // was ambient and lose the HTTP hop.
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        applyCarrierToHeaders(tracer.inject(), headers);

        const response = await fetchImpl(input, { ...init, headers });

        span.setAttribute("http.response.status_code", response.status);
        // A 5xx from a dependency is that dependency's error and belongs
        // on this client span; a 4xx is usually this platform's own
        // request being rejected and is already visible in the status
        // code attribute without inflating the error rate.
        if (response.status >= 500) span.setStatus("error", `HTTP ${response.status}`);

        return response;
      },
      {
        kind: "client",
        attributes: {
          "external.system": system,
          "http.request.method": method,
          // Path only — a full URL routinely carries ids and tokens in
          // its query string, the same class of value `logger.ts`
          // redacts. `server.address` gives the host on its own.
          "url.path": url?.pathname,
          "server.address": url?.host,
        },
      },
    );
  };

  return traced;
}

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    if (input instanceof URL) return input;
    if (typeof input === "string") return new URL(input);
    return new URL(input.url);
  } catch {
    return null;
  }
}
