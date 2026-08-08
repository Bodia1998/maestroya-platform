import { vi } from "vitest";

import { nullSpan } from "@/application/ports/tracing";
import type { Span, SpanAttributes, SpanOptions, TraceCarrier, TraceContext, TracingPort } from "@/application/ports/tracing";

/**
 * Module 51 — Distributed Tracing test support.
 *
 * A minimal, in-memory `TracingPort` fake — no `@opentelemetry/*`
 * involved — for unit-testing every decorator/observer this module adds
 * (`TracedEventBus`, `TracingJobLifecycleObserver`, `TracedCacheProvider`,
 * ...) against the *port*, exactly as those decorators are written
 * against the port and nothing else. Mirrors the "fake over the port,
 * never the SDK" convention `tests/test-utils/fake-cache-provider.ts`
 * already establishes for `CacheProvider`.
 *
 * Every span opened via `startSpan`/`withSpan` is recorded to `spans` in
 * the order it was *started*, with its name, kind, attributes, events,
 * exceptions, status and end state — enough for a test to assert on
 * shape without reaching into OpenTelemetry internals.
 */
export interface RecordedSpan {
  name: string;
  kind: SpanOptions["kind"];
  attributes: SpanAttributes;
  events: { name: string; attributes?: SpanAttributes }[];
  exceptions: unknown[];
  status: { status: "ok" | "error"; message?: string } | null;
  ended: boolean;
  parent: TraceCarrier | null | undefined;
}

export interface FakeTracer extends TracingPort {
  spans: RecordedSpan[];
}

let counter = 0;

/**
 * Builds a `FakeTracer`. `enabled` defaults to `true` (a test opting into
 * a fake tracer is, by construction, testing the enabled path) — pass
 * `false` to assert a decorator's disabled/no-op behaviour without
 * touching `nullTracer` directly.
 */
export function createFakeTracer(options: { enabled?: boolean } = {}): FakeTracer {
  const enabled = options.enabled ?? true;
  const spans: RecordedSpan[] = [];
  let active: RecordedSpan | null = null;

  function makeSpan(name: string, spanOptions?: SpanOptions): { span: Span; record: RecordedSpan } {
    counter += 1;
    const id = counter;
    const record: RecordedSpan = {
      name,
      kind: spanOptions?.kind ?? "internal",
      attributes: { ...spanOptions?.attributes },
      events: [],
      exceptions: [],
      status: null,
      ended: false,
      parent: spanOptions?.parent,
    };
    spans.push(record);

    const span: Span = {
      setAttribute(key, value) {
        if (value === null || value === undefined) return;
        record.attributes[key] = value;
      },
      setAttributes(attrs) {
        Object.assign(record.attributes, attrs);
      },
      addEvent(eventName, attrs) {
        record.events.push({ name: eventName, attributes: attrs });
      },
      recordException(error) {
        record.exceptions.push(error);
      },
      setStatus(status, message) {
        record.status = { status, message };
      },
      end() {
        record.ended = true;
      },
      get context(): TraceContext | null {
        return { traceId: `trace-${id}`, spanId: `span-${id}`, correlationId: `trace-${id}` };
      },
    };

    return { span, record };
  }

  const tracer: FakeTracer = {
    enabled,
    spans,
    startSpan(name, spanOptions) {
      if (!enabled) return nullSpan;
      const { span } = makeSpan(name, spanOptions);
      return span;
    },
    async withSpan(name, fn, spanOptions) {
      if (!enabled) return fn(nullSpan);

      const { span, record } = makeSpan(name, spanOptions);
      const previous = active;
      active = record;
      try {
        return await fn(span);
      } catch (error) {
        record.exceptions.push(error);
        record.status = { status: "error", message: error instanceof Error ? error.message : String(error) };
        throw error;
      } finally {
        record.ended = true;
        active = previous;
      }
    },
    currentSpan() {
      return null;
    },
    currentContext() {
      return null;
    },
    inject: vi.fn((carrier: TraceCarrier = {}) => carrier),
  };

  return tracer;
}
