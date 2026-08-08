import { ExportResultCode } from "@opentelemetry/core";
import type { ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-node";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_EXPORT_FAILURE_THRESHOLD, ResilientSpanExporter } from "@/infrastructure/tracing/providers/resilient-span-exporter";

function fakeSpan(): ReadableSpan {
  return {} as ReadableSpan;
}

function exportOnce(exporter: SpanExporter, spans: ReadableSpan[]): Promise<ExportResult> {
  return new Promise((resolve) => exporter.export(spans, resolve));
}

/**
 * Module 51 — Distributed Tracing — the exporter failure-behaviour
 * requirement: "if the exporter fails: log, disable gracefully, continue
 * execution". These tests exercise `ResilientSpanExporter` directly
 * against a fake delegate, with no real network/collector involved.
 */
describe("infrastructure/tracing/providers/ResilientSpanExporter", () => {
  it("delegates a successful export and always reports success upstream", async () => {
    const delegate: SpanExporter = {
      export: vi.fn((_spans, cb) => cb({ code: ExportResultCode.SUCCESS })),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
    const exporter = new ResilientSpanExporter(delegate, "test");

    const result = await exportOnce(exporter, [fakeSpan()]);

    expect(result.code).toBe(ExportResultCode.SUCCESS);
    expect(delegate.export).toHaveBeenCalledTimes(1);
    expect(exporter.isDisabled).toBe(false);
  });

  it("a failed export is still reported as success upstream (the processor must not hold/retry the batch)", async () => {
    const delegate: SpanExporter = {
      export: vi.fn((_spans, cb) => cb({ code: ExportResultCode.FAILED, error: new Error("network error") })),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
    const exporter = new ResilientSpanExporter(delegate, "test");

    const result = await exportOnce(exporter, [fakeSpan()]);

    expect(result.code).toBe(ExportResultCode.SUCCESS);
  });

  it("a synchronous throw from the delegate is caught and reported as success upstream", async () => {
    const delegate: SpanExporter = {
      export: vi.fn(() => {
        throw new Error("synchronous failure");
      }),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
    const exporter = new ResilientSpanExporter(delegate, "test");

    const result = await exportOnce(exporter, [fakeSpan()]);
    expect(result.code).toBe(ExportResultCode.SUCCESS);
  });

  it("disables itself after `failureThreshold` consecutive failures and stops calling the delegate", async () => {
    const delegate: SpanExporter = {
      export: vi.fn((_spans, cb) => cb({ code: ExportResultCode.FAILED, error: new Error("down") })),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
    const exporter = new ResilientSpanExporter(delegate, "test", { failureThreshold: 3 });

    for (let i = 0; i < 3; i++) {
      await exportOnce(exporter, [fakeSpan()]);
    }
    expect(exporter.isDisabled).toBe(true);
    expect(delegate.export).toHaveBeenCalledTimes(3);

    // A further export must not reach the delegate at all — spans are
    // dropped locally and reported as success.
    const result = await exportOnce(exporter, [fakeSpan()]);
    expect(result.code).toBe(ExportResultCode.SUCCESS);
    expect(delegate.export).toHaveBeenCalledTimes(3);
  });

  it("uses DEFAULT_EXPORT_FAILURE_THRESHOLD when no override is given", async () => {
    const delegate: SpanExporter = {
      export: vi.fn((_spans, cb) => cb({ code: ExportResultCode.FAILED, error: new Error("down") })),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
    const exporter = new ResilientSpanExporter(delegate, "test");

    for (let i = 0; i < DEFAULT_EXPORT_FAILURE_THRESHOLD - 1; i++) {
      await exportOnce(exporter, [fakeSpan()]);
      expect(exporter.isDisabled).toBe(false);
    }
    await exportOnce(exporter, [fakeSpan()]);
    expect(exporter.isDisabled).toBe(true);
  });

  it("a success resets the consecutive-failure counter so the breaker never trips on scattered failures", async () => {
    let shouldFail = true;
    const delegate: SpanExporter = {
      export: vi.fn((_spans, cb) => {
        cb(shouldFail ? { code: ExportResultCode.FAILED, error: new Error("down") } : { code: ExportResultCode.SUCCESS });
      }),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
    const exporter = new ResilientSpanExporter(delegate, "test", { failureThreshold: 2 });

    await exportOnce(exporter, [fakeSpan()]); // fail 1
    shouldFail = false;
    await exportOnce(exporter, [fakeSpan()]); // success — resets counter
    shouldFail = true;
    await exportOnce(exporter, [fakeSpan()]); // fail 1 again
    expect(exporter.isDisabled).toBe(false);
  });

  it("forceFlush/shutdown delegate normally, and never throw even if the delegate does", async () => {
    const delegate: SpanExporter = {
      export: vi.fn((_spans, cb) => cb({ code: ExportResultCode.SUCCESS })),
      shutdown: vi.fn().mockRejectedValue(new Error("shutdown failed")),
      forceFlush: vi.fn().mockRejectedValue(new Error("flush failed")),
    };
    const exporter = new ResilientSpanExporter(delegate, "test");

    await expect(exporter.shutdown()).resolves.toBeUndefined();
    await expect(exporter.forceFlush()).resolves.toBeUndefined();
  });

  it("forceFlush is a no-op once disabled", async () => {
    const delegate: SpanExporter = {
      export: vi.fn((_spans, cb) => cb({ code: ExportResultCode.FAILED, error: new Error("down") })),
      shutdown: vi.fn().mockResolvedValue(undefined),
      forceFlush: vi.fn().mockResolvedValue(undefined),
    };
    const exporter = new ResilientSpanExporter(delegate, "test", { failureThreshold: 1 });
    await exportOnce(exporter, [fakeSpan()]);
    expect(exporter.isDisabled).toBe(true);

    await exporter.forceFlush();
    expect(delegate.forceFlush).not.toHaveBeenCalled();
  });
});
