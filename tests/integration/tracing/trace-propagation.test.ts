import { context, propagation, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DomainEvent } from "@/domain/events/domain-event";
import type { EventBus, EventHandler } from "@/application/ports/event-bus";
import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import { InMemoryJobStore } from "@/infrastructure/jobs/in-memory-job-store";
import { toActiveJob } from "@/infrastructure/jobs/job-types";
import { Queue } from "@/infrastructure/jobs/queue";
import { OtelTracer } from "@/infrastructure/tracing/otel-tracer";
import { TracedEventBus } from "@/infrastructure/tracing/event-bus-tracing";
import { TracingJobLifecycleObserver } from "@/infrastructure/tracing/job-tracing";
import { createTracedFetch } from "@/infrastructure/tracing/traced-fetch";

/**
 * Module 51 — Distributed Tracing — end-to-end propagation.
 *
 * Unlike the unit tests elsewhere in this module (all written against a
 * `FakeTracer`, deliberately independent of `@opentelemetry/*`), this
 * suite registers a **real** `NodeTracerProvider` with an
 * `InMemorySpanExporter`, exactly as `otel-sdk.ts` does in production
 * (minus the network exporter), and asserts on the actual span records
 * OpenTelemetry produces. This is the only place in the codebase that
 * verifies the thing the whole module exists for: that an HTTP request,
 * an enqueued job, the worker that later processes it, a published
 * domain event and its handler, and an outbound `fetch` call all end up
 * as **one trace** — same `traceId` — with the correct parent/child
 * relationships, not four unrelated ones.
 *
 * The provider is registered/unregistered around this file only
 * (`beforeAll`/`afterAll`), the same "own the global OTel registration
 * for the file's lifetime" pattern `otel-sdk.ts` itself documents.
 */

let memoryExporter: InMemorySpanExporter;
let provider: NodeTracerProvider;
let tracer: OtelTracer;

beforeAll(() => {
  memoryExporter = new InMemorySpanExporter();
  provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(memoryExporter)] });
  provider.register({ propagator: new W3CTraceContextPropagator() });
  tracer = new OtelTracer();
});

afterAll(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
  propagation.disable();
});

beforeEach(() => {
  memoryExporter.reset();
});

function spanNamed(name: string) {
  const span = memoryExporter.getFinishedSpans().find((s) => s.name === name);
  if (!span) throw new Error(`no finished span named "${name}" — got: ${memoryExporter.getFinishedSpans().map((s) => s.name).join(", ")}`);
  return span;
}

describe("Module 51 — trace propagation (real OpenTelemetry provider, in-memory exporter)", () => {
  it("HTTP request → job enqueue → worker execution share one trace", async () => {
    const store = new InMemoryJobStore();
    const queue = new Queue("notifications", { store, tracer });
    const delegate = { onQueued() {}, onActive() {}, onCompleted() {}, onRetried() {}, onFailed() {}, onSkippedAsDuplicate() {}, onDeadLetterFailed() {} };
    const observer = new TracingJobLifecycleObserver(delegate, tracer);

    let storedJob: Awaited<ReturnType<typeof queue.add>> = null;

    // Simulate the inbound HTTP request span (what `withApiTracing` opens).
    await tracer.withSpan(
      "POST /api/dispute/create",
      async () => {
        storedJob = await queue.add("send-dispute-email", { disputeId: "d-1" });
      },
      { kind: "server" },
    );

    expect(storedJob).not.toBeNull();
    expect(storedJob!.trace).toBeDefined(); // the request's trace context was captured onto the job

    // Simulate the worker picking the job up later (possibly another process).
    const activeJob = toActiveJob(storedJob!);
    observer.onActive(activeJob);
    observer.onCompleted(activeJob, 42);

    const requestSpan = spanNamed("POST /api/dispute/create");
    const jobSpan = spanNamed("job.process notifications");

    expect(jobSpan.spanContext().traceId).toBe(requestSpan.spanContext().traceId);
    expect(jobSpan.parentSpanId).toBe(requestSpan.spanContext().spanId);
  });

  it("a job enqueued with no active trace starts a fresh trace, not an error", async () => {
    const store = new InMemoryJobStore();
    const queue = new Queue("notifications", { store, tracer });

    const job = await queue.add("send-dispute-email", { disputeId: "d-2" });

    expect(job!.trace).toBeUndefined(); // nothing was ambient — no field written at all
  });

  it("event bus publish → handler execution share one trace with the request that published it", async () => {
    class DisputeCreated extends DomainEvent {
      static readonly eventName = "dispute.created";
      constructor() {
        super();
      }
    }

    let handlerRan = false;
    const handler: EventHandler<DisputeCreated> = {
      async handle() {
        handlerRan = true;
      },
    };

    const bus: EventBus = new TracedEventBus(new SynchronousEventBus(), tracer);
    bus.subscribe(DisputeCreated, handler);

    await tracer.withSpan(
      "POST /api/dispute/create",
      async () => {
        await bus.publish(new DisputeCreated());
      },
      { kind: "server" },
    );

    expect(handlerRan).toBe(true);

    const requestSpan = spanNamed("POST /api/dispute/create");
    const publishSpan = spanNamed("event.publish dispute.created");
    const handlerName = handler.constructor.name === "Object" ? "anonymous" : handler.constructor.name;
    const handleSpan = spanNamed(`event.handle dispute.created ${handlerName}`);

    expect(publishSpan.spanContext().traceId).toBe(requestSpan.spanContext().traceId);
    expect(publishSpan.parentSpanId).toBe(requestSpan.spanContext().spanId);
    expect(handleSpan.spanContext().traceId).toBe(requestSpan.spanContext().traceId);
    expect(handleSpan.parentSpanId).toBe(publishSpan.spanContext().spanId);
  });

  it("an outbound traced fetch carries the active trace's id in the injected traceparent header", async () => {
    let capturedTraceparent: string | null = null;
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      capturedTraceparent = headers.get("traceparent");
      return new Response(null, { status: 200 });
    };
    const tracedFetch = createTracedFetch("stripe", fetchImpl, tracer);

    await tracer.withSpan(
      "POST /api/payments/charge",
      async () => {
        await tracedFetch("https://api.stripe.com/v1/charges");
      },
      { kind: "server" },
    );

    const requestSpan = spanNamed("POST /api/payments/charge");
    expect(capturedTraceparent).not.toBeNull();
    // W3C traceparent format: 00-<32 hex traceId>-<16 hex spanId>-<flags>
    expect(capturedTraceparent).toContain(requestSpan.spanContext().traceId);
  });

  it("TracingPort.inject()/extract() round-trips a carrier across a serialization boundary (Redis-safe flat string map)", async () => {
    let carrier: Record<string, string> = {};

    await tracer.withSpan(
      "root",
      async () => {
        carrier = tracer.inject();
      },
      { kind: "internal" },
    );

    // Simulate the round trip through `RedisJobStore`'s JSON.stringify/parse.
    const roundTripped = JSON.parse(JSON.stringify(carrier));
    expect(roundTripped).toEqual(carrier);
    expect(Object.keys(roundTripped)).toContain("traceparent");

    let childTraceId: string | null = null;
    await tracer.withSpan(
      "child",
      async (span) => {
        childTraceId = span.context?.traceId ?? null;
      },
      { kind: "consumer", parent: roundTripped },
    );

    const rootSpan = spanNamed("root");
    expect(childTraceId).toBe(rootSpan.spanContext().traceId);
  });
});
