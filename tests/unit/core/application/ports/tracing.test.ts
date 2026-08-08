import { describe, expect, it } from "vitest";

import { nullSpan, nullTracer } from "@/application/ports/tracing";

/**
 * Module 51 — Distributed Tracing.
 *
 * `nullTracer`/`nullSpan` are what every process gets when
 * `TRACING_ENABLED` is not `"true"` (the default) — these tests pin down
 * the "disabled mode" contract the rest of the module's tests, and every
 * decorator's disabled branch, rely on: no-op, allocation-free, and
 * `withSpan` still runs and returns/throws exactly what the wrapped
 * function does.
 */
describe("application/ports/tracing — nullTracer / nullSpan", () => {
  it("nullTracer.enabled is false", () => {
    expect(nullTracer.enabled).toBe(false);
  });

  it("nullSpan's methods are all safe no-ops and its context is null", () => {
    expect(() => nullSpan.setAttribute("k", "v")).not.toThrow();
    expect(() => nullSpan.setAttributes({ k: "v" })).not.toThrow();
    expect(() => nullSpan.addEvent("e")).not.toThrow();
    expect(() => nullSpan.recordException(new Error("boom"))).not.toThrow();
    expect(() => nullSpan.setStatus("error", "boom")).not.toThrow();
    expect(() => nullSpan.end()).not.toThrow();
    expect(nullSpan.context).toBeNull();
  });

  it("startSpan always returns nullSpan", () => {
    expect(nullTracer.startSpan("anything")).toBe(nullSpan);
  });

  it("withSpan still invokes fn and resolves with its return value", async () => {
    const result = await nullTracer.withSpan("op", (span) => {
      expect(span).toBe(nullSpan);
      return 42;
    });
    expect(result).toBe(42);
  });

  it("withSpan awaits an async fn and resolves with its value", async () => {
    const result = await nullTracer.withSpan("op", async () => "done");
    expect(result).toBe("done");
  });

  it("withSpan propagates a thrown error unchanged", async () => {
    const error = new Error("failure");
    await expect(
      nullTracer.withSpan("op", () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });

  it("withSpan propagates a rejected promise unchanged", async () => {
    const error = new Error("async failure");
    await expect(nullTracer.withSpan("op", async () => Promise.reject(error))).rejects.toBe(error);
  });

  it("currentSpan/currentContext are null", () => {
    expect(nullTracer.currentSpan()).toBeNull();
    expect(nullTracer.currentContext()).toBeNull();
  });

  it("inject returns the carrier untouched (empty object by default)", () => {
    expect(nullTracer.inject()).toEqual({});
    const carrier = { traceparent: "already-here" };
    expect(nullTracer.inject(carrier)).toBe(carrier);
  });
});
