import { describe, expect, it, vi } from "vitest";

import { createTracedFetch } from "@/infrastructure/tracing/traced-fetch";
import { createFakeTracer } from "../../../../test-utils/fake-tracer";

describe("infrastructure/tracing/traced-fetch", () => {
  it("returns the original fetch implementation unchanged when tracing is disabled", () => {
    const tracer = createFakeTracer({ enabled: false });
    const fetchImpl = vi.fn();
    expect(createTracedFetch("stripe", fetchImpl, tracer)).toBe(fetchImpl);
  });

  it("wraps fetch in a client span carrying the external system and method", async () => {
    const tracer = createFakeTracer();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const traced = createTracedFetch("stripe", fetchImpl, tracer);

    await traced("https://api.stripe.com/v1/charges", { method: "POST" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const span = tracer.spans[0]!;
    expect(span.name).toBe("HTTP POST");
    expect(span.kind).toBe("client");
    expect(span.attributes["external.system"]).toBe("stripe");
    expect(span.attributes["http.request.method"]).toBe("POST");
    expect(span.attributes["server.address"]).toBe("api.stripe.com");
    // Never the full URL with query string — path only.
    expect(span.attributes["url.path"]).toBe("/v1/charges");
  });

  it("injects trace-context headers into the outgoing request", async () => {
    const tracer = createFakeTracer();
    (tracer.inject as ReturnType<typeof vi.fn>).mockImplementation((carrier: Record<string, string> = {}) => {
      carrier.traceparent = "00-abc-def-01";
      return carrier;
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const traced = createTracedFetch("twilio", fetchImpl, tracer);

    await traced("https://api.twilio.com/send");

    const [, init] = fetchImpl.mock.calls[0]!;
    const headers = new Headers(init.headers);
    expect(headers.get("traceparent")).toBe("00-abc-def-01");
  });

  it("marks the span as error for a 5xx response, but not for a 4xx", async () => {
    const tracer = createFakeTracer();
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null, { status: 500 }));
    const traced = createTracedFetch("stripe", fetchImpl, tracer);
    await traced("https://api.stripe.com/v1/charges");
    expect(tracer.spans[0]!.status?.status).toBe("error");

    tracer.spans.length = 0;
    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await traced("https://api.stripe.com/v1/charges");
    expect(tracer.spans[0]!.status).toBeNull();
  });

  it("propagates a thrown/rejected fetch error unchanged", async () => {
    const tracer = createFakeTracer();
    const error = new Error("network down");
    const fetchImpl = vi.fn().mockRejectedValue(error);
    const traced = createTracedFetch("resend", fetchImpl, tracer);

    await expect(traced("https://api.resend.com/emails")).rejects.toBe(error);
  });

  it("returns exactly the delegate's Response", async () => {
    const tracer = createFakeTracer();
    const response = new Response("ok", { status: 200 });
    const fetchImpl = vi.fn().mockResolvedValue(response);
    const traced = createTracedFetch("resend", fetchImpl, tracer);

    const result = await traced("https://api.resend.com/emails");
    expect(result).toBe(response);
  });
});
