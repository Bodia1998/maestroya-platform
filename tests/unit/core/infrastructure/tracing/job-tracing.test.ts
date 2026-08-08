import { describe, expect, it, vi } from "vitest";

import type { JobLifecycleObserver } from "@/infrastructure/jobs/job-observability";
import type { ActiveJob } from "@/infrastructure/jobs/job-types";
import { TracingJobLifecycleObserver, withJobTracing } from "@/infrastructure/tracing/job-tracing";
import { createFakeTracer } from "../../../../test-utils/fake-tracer";

function fakeDelegate(): JobLifecycleObserver & Record<string, ReturnType<typeof vi.fn>> {
  return {
    onQueued: vi.fn(),
    onActive: vi.fn(),
    onCompleted: vi.fn(),
    onRetried: vi.fn(),
    onFailed: vi.fn(),
    onSkippedAsDuplicate: vi.fn(),
    onDeadLetterFailed: vi.fn(),
  };
}

function activeJob(overrides: Partial<ActiveJob> = {}): ActiveJob {
  return {
    id: "job-1",
    queue: "notifications",
    name: "send-email",
    data: {},
    attempt: 1,
    maxAttempts: 3,
    ...overrides,
  };
}

describe("infrastructure/tracing/job-tracing", () => {
  describe("withJobTracing", () => {
    it("returns the delegate untouched when tracing is disabled", () => {
      const tracer = createFakeTracer({ enabled: false });
      const delegate = fakeDelegate();
      expect(withJobTracing(delegate, tracer)).toBe(delegate);
    });

    it("wraps the delegate in TracingJobLifecycleObserver when enabled", () => {
      const tracer = createFakeTracer();
      const delegate = fakeDelegate();
      expect(withJobTracing(delegate, tracer)).toBeInstanceOf(TracingJobLifecycleObserver);
    });
  });

  describe("TracingJobLifecycleObserver", () => {
    it("onQueued() calls the delegate first, then opens and immediately ends a producer span with the queue name", () => {
      const tracer = createFakeTracer();
      const delegate = fakeDelegate();
      const observer = new TracingJobLifecycleObserver(delegate, tracer);

      observer.onQueued({ id: "job-1", queue: "notifications", name: "send-email", delayMs: 0 });

      expect(delegate.onQueued).toHaveBeenCalledTimes(1);
      const span = tracer.spans.find((s) => s.name === "queue.enqueue notifications");
      expect(span?.kind).toBe("producer");
      expect(span?.attributes["messaging.destination.name"]).toBe("notifications");
      expect(span?.ended).toBe(true);
    });

    it("onActive() opens a consumer span parented to the job's trace carrier, held open until a terminal hook", () => {
      const tracer = createFakeTracer();
      const delegate = fakeDelegate();
      const observer = new TracingJobLifecycleObserver(delegate, tracer);
      const carrier = { traceparent: "00-abc-def-01" };

      observer.onActive(activeJob({ trace: carrier }));

      expect(delegate.onActive).toHaveBeenCalledTimes(1);
      const span = tracer.spans.find((s) => s.name === "job.process notifications");
      expect(span?.kind).toBe("consumer");
      expect(span?.parent).toBe(carrier);
      expect(span?.ended).toBe(false); // still open — no terminal hook yet
    });

    it("onActive() with no trace carrier parents to null (starts a fresh trace, not an error)", () => {
      const tracer = createFakeTracer();
      const observer = new TracingJobLifecycleObserver(fakeDelegate(), tracer);
      observer.onActive(activeJob());
      expect(tracer.spans[0]!.parent).toBeNull();
    });

    it("onCompleted() closes the active span with the outcome and duration", () => {
      const tracer = createFakeTracer();
      const delegate = fakeDelegate();
      const observer = new TracingJobLifecycleObserver(delegate, tracer);
      const job = activeJob();

      observer.onActive(job);
      observer.onCompleted(job, 250);

      expect(delegate.onCompleted).toHaveBeenCalledWith(job, 250);
      const span = tracer.spans.find((s) => s.name === "job.process notifications");
      expect(span?.ended).toBe(true);
      expect(span?.attributes["job.outcome"]).toBe("completed");
      expect(span?.attributes["job.duration_ms"]).toBe(250);
    });

    it("onRetried() records the exception but does not mark the span as an error status (self-healing, not a failure)", () => {
      const tracer = createFakeTracer();
      const observer = new TracingJobLifecycleObserver(fakeDelegate(), tracer);
      const job = activeJob();
      const error = new Error("temporary failure");

      observer.onActive(job);
      observer.onRetried(job, error, 5_000);

      const span = tracer.spans.find((s) => s.name === "job.process notifications");
      expect(span?.ended).toBe(true);
      expect(span?.exceptions).toContain(error);
      expect(span?.status).toBeNull(); // not setStatus("error") — see this observer's doc comment
      expect(span?.attributes["job.outcome"]).toBe("retry_scheduled");
    });

    it("onFailed() sets an error status on the span (attempts exhausted, dead-lettered)", () => {
      const tracer = createFakeTracer();
      const observer = new TracingJobLifecycleObserver(fakeDelegate(), tracer);
      const job = activeJob();
      const error = new Error("permanent failure");

      observer.onActive(job);
      observer.onFailed(job, error);

      const span = tracer.spans.find((s) => s.name === "job.process notifications");
      expect(span?.status?.status).toBe("error");
      expect(span?.attributes["job.outcome"]).toBe("failed");
    });

    it("onSkippedAsDuplicate() closes the span with the idempotency key recorded", () => {
      const tracer = createFakeTracer();
      const observer = new TracingJobLifecycleObserver(fakeDelegate(), tracer);
      const job = activeJob();

      observer.onActive(job);
      observer.onSkippedAsDuplicate(job, "idem-key-1");

      const span = tracer.spans.find((s) => s.name === "job.process notifications");
      expect(span?.ended).toBe(true);
      expect(span?.attributes["job.outcome"]).toBe("skipped_duplicate");
      expect(span?.events.some((e) => e.name === "job.skipped_duplicate")).toBe(true);
    });

    it("onDeadLetterFailed() opens and closes its own standalone error span", () => {
      const tracer = createFakeTracer();
      const observer = new TracingJobLifecycleObserver(fakeDelegate(), tracer);
      const job = activeJob();
      const error = new Error("dead-letter enqueue failed");

      observer.onDeadLetterFailed(job, error);

      const span = tracer.spans.find((s) => s.name === "job.dead_letter_failed notifications");
      expect(span?.status?.status).toBe("error");
      expect(span?.ended).toBe(true);
    });

    it("a terminal hook for an unknown job id is a safe no-op (never throws)", () => {
      const tracer = createFakeTracer();
      const observer = new TracingJobLifecycleObserver(fakeDelegate(), tracer);
      expect(() => observer.onCompleted(activeJob({ id: "never-started" }), 10)).not.toThrow();
    });

    it("calls the delegate first and unconditionally, even if tracing itself would throw", () => {
      const tracer = createFakeTracer();
      // Force the tracer to throw on startSpan to prove the delegate call
      // (logging/Sentry) is unaffected.
      tracer.startSpan = () => {
        throw new Error("tracing backend exploded");
      };
      const delegate = fakeDelegate();
      const observer = new TracingJobLifecycleObserver(delegate, tracer);

      expect(() => observer.onQueued({ id: "1", queue: "q", name: "n", delayMs: 0 })).not.toThrow();
      expect(delegate.onQueued).toHaveBeenCalledTimes(1);
    });
  });
});
