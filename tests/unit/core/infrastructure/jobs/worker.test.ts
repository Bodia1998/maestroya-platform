import { describe, expect, it, vi } from "vitest";

import { InMemoryJobStore } from "@/infrastructure/jobs/in-memory-job-store";
import { InMemoryJobIdempotencyStore } from "@/infrastructure/jobs/job-idempotency-store";
import { nullJobLifecycleObserver } from "@/infrastructure/jobs/job-observability";
import { Queue } from "@/infrastructure/jobs/queue";
import type { DeadLetterJobData } from "@/infrastructure/jobs/worker";
import { Worker } from "@/infrastructure/jobs/worker";

describe("infrastructure/jobs/worker", () => {
  it("processNext() runs the processor and marks the job complete", async () => {
    const store = new InMemoryJobStore();
    const queue = new Queue("emails", { store });
    await queue.add("send-welcome", { to: "a@b.com" });

    const processor = vi.fn().mockResolvedValue(undefined);
    const worker = new Worker("emails", processor, { store });

    const ran = await worker.processNext();

    expect(ran).toBe(true);
    expect(processor).toHaveBeenCalledTimes(1);
    expect(processor.mock.calls[0]![0].data).toEqual({ to: "a@b.com" });
    expect((await queue.getCounts()).completed).toBe(1);
  });

  it("processNext() returns false when nothing is due", async () => {
    const store = new InMemoryJobStore();
    const worker = new Worker("emails", vi.fn(), { store });
    expect(await worker.processNext()).toBe(false);
  });

  it("retries a failing job with exponential backoff while attempts remain", async () => {
    const store = new InMemoryJobStore();
    let now = 0;
    // The queue and the worker must share one clock: `add()` stamps
    // `processAt` from the queue's own `now`, and `reserve()` (driven by
    // the worker) only claims jobs whose `processAt <= now` on *its*
    // clock. A queue defaulting to the real wall clock while the worker
    // runs a virtual one from 0 would stamp `processAt` far in the
    // future relative to the worker's `now` and the job would never be
    // reserved at all.
    const queue = new Queue("emails", { store, now: () => now });
    await queue.add("send-welcome", {}, { attempts: 3, backoff: { type: "exponential", delay: 1000 } });

    const processor = vi.fn().mockRejectedValue(new Error("smtp down"));
    const onRetried = vi.fn();
    const worker = new Worker("emails", processor, {
      store,
      now: () => now,
      observer: { ...nullJobLifecycleObserver, onRetried },
    });

    await worker.processNext();

    expect(processor).toHaveBeenCalledTimes(1);
    expect(onRetried).toHaveBeenCalledTimes(1);
    // First failed attempt (attemptsMade=1) backs off 1000ms.
    expect(onRetried.mock.calls[0]![2]).toBe(1000);
    // Not due again until the backoff elapses.
    expect(await worker.processNext()).toBe(false);

    now = 1000;
    expect(await worker.processNext()).toBe(true);
    expect(processor).toHaveBeenCalledTimes(2);
  });

  it("dead-letters a job once attempts are exhausted, and reports both failure and dead-letter", async () => {
    const store = new InMemoryJobStore();
    const queue = new Queue("emails", { store });
    const dlq = new Queue<DeadLetterJobData>("emails-dead-letter", { store });
    await queue.add("send-welcome", { to: "a@b.com" }, { attempts: 1 });

    const onFailed = vi.fn();
    const worker = new Worker("emails", vi.fn().mockRejectedValue(new Error("permanently broken")), {
      store,
      deadLetterQueue: dlq,
      observer: { ...nullJobLifecycleObserver, onFailed },
    });

    await worker.processNext();

    expect(onFailed).toHaveBeenCalledTimes(1);
    expect((await queue.getCounts()).failed).toBe(1);
    expect((await dlq.getCounts()).waiting).toBe(1);

    const dlqStore = store;
    const dlqJob = await dlqStore.reserve("emails-dead-letter", Date.now());
    expect(dlqJob?.data).toMatchObject({
      originalQueue: "emails",
      jobName: "send-welcome",
      data: { to: "a@b.com" },
      failedReason: "permanently broken",
    });
  });

  it("re-dead-lettering the same exhausted job parks one dead-letter entry, not two", async () => {
    const store = new InMemoryJobStore();
    const queue = new Queue("emails", { store });
    const dlq = new Queue<DeadLetterJobData>("emails-dead-letter", { store });
    await queue.add("send-welcome", {}, { attempts: 1, jobId: "fixed-id" });

    const worker = new Worker("emails", vi.fn().mockRejectedValue(new Error("boom")), {
      store,
      deadLetterQueue: dlq,
    });
    await worker.processNext();
    expect((await dlq.getCounts()).waiting).toBe(1);

    // Simulate the same job failing again after being manually replayed.
    await queue.add("send-welcome", {}, { attempts: 1, jobId: "fixed-id" });
    const worker2 = new Worker("emails", vi.fn().mockRejectedValue(new Error("boom again")), {
      store,
      deadLetterQueue: dlq,
    });
    await worker2.processNext();

    expect((await dlq.getCounts()).waiting).toBe(1);
  });

  it("skips a job whose idempotency key was already marked processed, without running the processor", async () => {
    const store = new InMemoryJobStore();
    const queue = new Queue("emails", { store });
    await queue.add("send-welcome", {});

    const idempotencyStore = new InMemoryJobIdempotencyStore();
    await idempotencyStore.markProcessed("dedupe-key", 60_000);

    const processor = vi.fn();
    const onSkipped = vi.fn();
    const worker = new Worker("emails", processor, {
      store,
      idempotency: { store: idempotencyStore, keyFor: () => "dedupe-key" },
      observer: { ...nullJobLifecycleObserver, onSkippedAsDuplicate: onSkipped },
    });

    await worker.processNext();

    expect(processor).not.toHaveBeenCalled();
    expect(onSkipped).toHaveBeenCalledTimes(1);
    expect((await queue.getCounts()).completed).toBe(1);
  });

  it("marks the idempotency key processed only after the handler succeeds", async () => {
    const store = new InMemoryJobStore();
    const queue = new Queue("emails", { store });
    await queue.add("send-welcome", {});

    const idempotencyStore = new InMemoryJobIdempotencyStore();
    const worker = new Worker("emails", vi.fn().mockResolvedValue(undefined), {
      store,
      idempotency: { store: idempotencyStore, keyFor: () => "dedupe-key" },
    });

    await worker.processNext();

    expect(await idempotencyStore.isProcessed("dedupe-key")).toBe(true);
  });

  it("does not mark the idempotency key when the handler throws (stays retryable)", async () => {
    const store = new InMemoryJobStore();
    const queue = new Queue("emails", { store });
    await queue.add("send-welcome", {}, { attempts: 2 });

    const idempotencyStore = new InMemoryJobIdempotencyStore();
    const worker = new Worker("emails", vi.fn().mockRejectedValue(new Error("boom")), {
      store,
      idempotency: { store: idempotencyStore, keyFor: () => "dedupe-key" },
    });

    await worker.processNext();

    expect(await idempotencyStore.isProcessed("dedupe-key")).toBe(false);
  });

  it("a throwing keyFor opting a job out (returning null) runs the processor normally", async () => {
    const store = new InMemoryJobStore();
    const queue = new Queue("emails", { store });
    await queue.add("send-welcome", {});

    const processor = vi.fn().mockResolvedValue(undefined);
    const worker = new Worker("emails", processor, {
      store,
      idempotency: { store: new InMemoryJobIdempotencyStore(), keyFor: () => null },
    });

    await worker.processNext();
    expect(processor).toHaveBeenCalledTimes(1);
  });

  it("start()/close() control the polling loop; close() waits for in-flight work", async () => {
    const store = new InMemoryJobStore();
    const queue = new Queue("emails", { store });
    await queue.add("send-welcome", {});

    let resolveWork!: () => void;
    let worker!: Worker;
    const workStarted = new Promise<void>((resolve) => {
      const processor = vi.fn(async () => {
        resolve();
        await new Promise<void>((r) => (resolveWork = r));
      });
      worker = new Worker("emails", processor, { store, pollIntervalMs: 5 });
    });
    worker.start();
    expect(worker.isRunning).toBe(true);

    await workStarted;
    expect(worker.inFlightCount).toBe(1);

    const closePromise = worker.close();
    resolveWork();
    await closePromise;

    expect(worker.isRunning).toBe(false);
    expect(worker.inFlightCount).toBe(0);
  });

  it("close() is safe to call when the worker was never started, and safe to call twice", async () => {
    const store = new InMemoryJobStore();
    const worker = new Worker("emails", vi.fn(), { store });

    await expect(worker.close()).resolves.toBeUndefined();
    await expect(worker.close()).resolves.toBeUndefined();
  });

  it("a store failure during reserve() is reported but does not stop the worker", async () => {
    const store = new InMemoryJobStore();
    const failingReserve = vi.spyOn(store, "reserve").mockRejectedValueOnce(new Error("redis down"));

    const onDeadLetterFailed = vi.fn();
    const worker = new Worker("emails", vi.fn(), {
      store,
      pollIntervalMs: 5,
      observer: { ...nullJobLifecycleObserver, onDeadLetterFailed },
    });

    worker.start();
    await vi.waitFor(() => expect(onDeadLetterFailed).toHaveBeenCalled(), { timeout: 2000 });
    expect(worker.isRunning).toBe(true);

    await worker.close();
    failingReserve.mockRestore();
  });
});
