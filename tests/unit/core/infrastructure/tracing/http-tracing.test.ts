import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeTracer } from "../../../../test-utils/fake-tracer";

/**
 * `withApiTracing` resolves its tracer through `getTracer()` in
 * `infrastructure/tracing/compose.ts` — mocked here so these tests never
 * need `TRACING_ENABLED=true` or a real OpenTelemetry provider, mirroring
 * how the decorator tests mock nothing but the port.
 */
let fakeTracer = createFakeTracer({ enabled: false });

vi.mock("@/infrastructure/tracing/compose", () => ({
  getTracer: () => fakeTracer,
}));

afterEach(() => {
  vi.clearAllMocks();
});

async function importSubject() {
  return import("@/infrastructure/tracing/http-tracing");
}

describe("infrastructure/tracing/http-tracing", () => {
  it("when tracing is disabled, the original handler is returned completely untouched (no wrapper call frame)", async () => {
    fakeTracer = createFakeTracer({ enabled: false });
    const { withApiTracing } = await importSubject();
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));

    const wrapped = withApiTracing("/api/test", handler);
    expect(wrapped).toBe(handler);
  });

  it("when enabled, wraps the handler in a server span capturing method, route, status, duration, and request id", async () => {
    fakeTracer = createFakeTracer({ enabled: true });
    const { withApiTracing } = await importSubject();
    const handler = vi.fn(async () => NextResponse.json({ ok: true }, { status: 200 }));

    const wrapped = withApiTracing("/api/test", handler);
    const request = new NextRequest("http://localhost:3000/api/test", { method: "GET" });
    const response = await wrapped(request);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);

    const span = fakeTracer.spans[0]!;
    expect(span.name).toBe("GET /api/test");
    expect(span.kind).toBe("server");
    expect(span.attributes["http.request.method"]).toBe("GET");
    expect(span.attributes["http.route"]).toBe("/api/test");
    expect(span.attributes["http.response.status_code"]).toBe(200);
    expect(typeof span.attributes["http.server.request.duration_ms"]).toBe("number");
    expect(typeof span.attributes["maestroya.request_id"]).toBe("string");
    expect(span.ended).toBe(true);
  });

  it("marks the span as error for a 5xx response but not for a 4xx", async () => {
    fakeTracer = createFakeTracer({ enabled: true });
    const { withApiTracing } = await importSubject();

    const failing = withApiTracing("/api/test", async () => NextResponse.json({}, { status: 500 }));
    await failing(new NextRequest("http://localhost:3000/api/test"));
    expect(fakeTracer.spans[0]!.status?.status).toBe("error");

    fakeTracer.spans.length = 0;
    const rejected = withApiTracing("/api/test", async () => NextResponse.json({}, { status: 404 }));
    await rejected(new NextRequest("http://localhost:3000/api/test"));
    expect(fakeTracer.spans[0]!.status).toBeNull();
  });

  it("records the duration and re-throws an exception unchanged, without swallowing it", async () => {
    fakeTracer = createFakeTracer({ enabled: true });
    const { withApiTracing } = await importSubject();
    const error = new Error("handler exploded");
    const wrapped = withApiTracing("/api/test", async () => {
      throw error;
    });

    await expect(wrapped(new NextRequest("http://localhost:3000/api/test"))).rejects.toBe(error);
    expect(fakeTracer.spans[0]!.attributes["http.server.request.duration_ms"]).toBeDefined();
  });

  it("parents the span to an inbound traceparent header when present", async () => {
    fakeTracer = createFakeTracer({ enabled: true });
    const { withApiTracing } = await importSubject();
    const wrapped = withApiTracing("/api/test", async () => NextResponse.json({}));

    await wrapped(
      new NextRequest("http://localhost:3000/api/test", {
        headers: { traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" },
      }),
    );

    expect(fakeTracer.spans[0]!.parent).toEqual({
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    });
  });

  describe("setTracedUserId", () => {
    it("is a no-op for a falsy user id", async () => {
      fakeTracer = createFakeTracer({ enabled: true });
      const { setTracedUserId } = await importSubject();
      expect(() => setTracedUserId(null)).not.toThrow();
      expect(() => setTracedUserId(undefined)).not.toThrow();
    });

    it("never throws even when there is no active span", async () => {
      fakeTracer = createFakeTracer({ enabled: true });
      const { setTracedUserId } = await importSubject();
      expect(() => setTracedUserId("user-42")).not.toThrow();
    });
  });
});
