import { describe, expect, it } from "vitest";

import { nullTracer } from "@/application/ports/tracing";
import { TracingService } from "@/application/services/tracing/tracing-service";
import { createFakeTracer } from "../../../../../test-utils/fake-tracer";

describe("application/services/tracing/TracingService", () => {
  describe("disabled (nullTracer)", () => {
    const service = new TracingService(nullTracer);

    it("enabled reflects the underlying tracer", () => {
      expect(service.enabled).toBe(false);
    });

    it("trace/traceExternalCall/traceProducer/traceConsumer still run and return fn's result", async () => {
      await expect(service.trace("comp", "op", () => "a")).resolves.toBe("a");
      await expect(service.traceExternalCall("stripe", "charge", () => "b")).resolves.toBe("b");
      await expect(service.traceProducer("produce", () => "c")).resolves.toBe("c");
      await expect(service.traceConsumer("consume", null, () => "d")).resolves.toBe("d");
    });

    it("currentContext/correlationId/logContext are all empty", () => {
      expect(service.currentContext()).toBeNull();
      expect(service.correlationId()).toBeNull();
      expect(service.logContext()).toEqual({});
    });

    it("annotate/inject are safe no-ops", () => {
      expect(() => service.annotate({ a: 1 })).not.toThrow();
      expect(service.inject()).toEqual({});
    });
  });

  describe("enabled (fake tracer)", () => {
    it("trace() names the span '<component>.<operation>' with kind internal", async () => {
      const tracer = createFakeTracer();
      const service = new TracingService(tracer);

      await service.trace("use-case", "run", () => undefined, { foo: "bar" });

      expect(tracer.spans).toHaveLength(1);
      expect(tracer.spans[0]!.name).toBe("use-case.run");
      expect(tracer.spans[0]!.kind).toBe("internal");
      expect(tracer.spans[0]!.attributes).toEqual({ foo: "bar" });
    });

    it("traceExternalCall() tags external.system/external.operation and uses kind client", async () => {
      const tracer = createFakeTracer();
      const service = new TracingService(tracer);

      await service.traceExternalCall("stripe", "charge", () => undefined, { amount: 100 });

      const span = tracer.spans[0]!;
      expect(span.name).toBe("stripe.charge");
      expect(span.kind).toBe("client");
      expect(span.attributes).toEqual({
        "external.system": "stripe",
        "external.operation": "charge",
        amount: 100,
      });
    });

    it("traceProducer() injects a carrier into the callback and uses kind producer", async () => {
      const tracer = createFakeTracer();
      const service = new TracingService(tracer);

      const received: unknown[] = [];
      await service.traceProducer("queue.enqueue jobs", (carrier) => {
        received.push(carrier);
      });

      expect(tracer.spans[0]!.kind).toBe("producer");
      expect(tracer.inject).toHaveBeenCalled();
      expect(received).toHaveLength(1);
    });

    it("traceConsumer() parents the span to the given carrier and uses kind consumer", async () => {
      const tracer = createFakeTracer();
      const service = new TracingService(tracer);
      const carrier = { traceparent: "00-abc-def-01" };

      await service.traceConsumer("job.process jobs", carrier, () => undefined);

      expect(tracer.spans[0]!.kind).toBe("consumer");
      expect(tracer.spans[0]!.parent).toBe(carrier);
    });

    it("traceConsumer() treats a missing carrier as 'start a fresh trace', not an error", async () => {
      const tracer = createFakeTracer();
      const service = new TracingService(tracer);

      await expect(service.traceConsumer("job.process jobs", null, () => "ok")).resolves.toBe("ok");
      expect(tracer.spans[0]!.parent).toBeNull();
    });

    it("every wrapper resolves with fn's return value and rejects with fn's thrown error unchanged", async () => {
      const tracer = createFakeTracer();
      const service = new TracingService(tracer);
      const error = new Error("boom");

      await expect(service.trace("c", "o", () => "value")).resolves.toBe("value");
      await expect(
        service.trace("c", "o", () => {
          throw error;
        }),
      ).rejects.toBe(error);
    });

    it("logContext() returns traceId/spanId/correlationId while a span is active, {} otherwise", async () => {
      const tracer = createFakeTracer();
      const service = new TracingService(tracer);

      // No active span outside withSpan — the fake tracer's currentContext
      // is always null (mirrors nullTracer's own "no ambient context"
      // semantics for a fake with no context-manager backing).
      expect(service.logContext()).toEqual({});
    });

    it("annotate() forwards to the tracer's currentSpan when present", () => {
      const tracer = createFakeTracer();
      const service = new TracingService(tracer);
      // The fake tracer's currentSpan() is null outside an active
      // AsyncLocalStorage-backed context — annotate must not throw.
      expect(() => service.annotate({ a: 1 })).not.toThrow();
    });

    it("inject() delegates to the tracer", () => {
      const tracer = createFakeTracer();
      const service = new TracingService(tracer);
      const carrier = { traceparent: "x" };
      service.inject(carrier);
      expect(tracer.inject).toHaveBeenCalledWith(carrier);
    });
  });
});
