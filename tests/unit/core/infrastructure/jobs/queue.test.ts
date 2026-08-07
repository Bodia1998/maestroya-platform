import { describe, expect, it, vi } from "vitest";

import { InMemoryJobStore } from "@/infrastructure/jobs/in-memory-job-store";
import { Queue } from "@/infrastructure/jobs/queue";
import { nullJobLifecycleObserver } from "@/infrastructure/jobs/job-observability";

describe("infrastructure/jobs/queue", () => {
  it("add() persists a job through the injected store and returns it", async () => {
    const store = new InMemoryJobStore();
    const queue = new Queue("emails", { store });

    const job = await queue.add("send-welcome", { to: "a@b.com" });

    expect(job).not.toBeNull();
    expect(job?.name).toBe("send-welcome");
    expect(job?.queue).toBe("emails");
    expect((await queue.getCounts()).waiting).toBe(1);
  });

  it("the same jobId enqueued twice produces exactly one job (null on the second add)", async () => {
    const store = new InMemoryJobStore();
    const queue = new Queue("emails", { store });

    const first = await queue.add("send-welcome", { to: "a@b.com" }, { jobId: "welcome:user-1" });
    const second = await queue.add("send-welcome", { to: "a@b.com" }, { jobId: "welcome:user-1" });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect((await queue.getCounts()).waiting).toBe(1);
  });

  it("a delayed job is not immediately due", async () => {
    const store = new InMemoryJobStore();
    let now = 1_000_000;
    const queue = new Queue("reminders", { store, now: () => now });

    await queue.add("remind", {}, { delay: 60_000 });
    expect((await queue.getCounts()).delayed).toBe(1);
    expect((await queue.getCounts()).waiting).toBe(0);

    now += 60_000;
    expect((await queue.getCounts()).waiting).toBe(1);
  });

  it("notifies the observer when a job is queued, but not when de-duplicated away", async () => {
    const store = new InMemoryJobStore();
    const observer = { ...nullJobLifecycleObserver, onQueued: vi.fn() };
    const queue = new Queue("emails", { store, observer });

    await queue.add("send-welcome", {}, { jobId: "dup" });
    await queue.add("send-welcome", {}, { jobId: "dup" });

    expect(observer.onQueued).toHaveBeenCalledTimes(1);
  });

  it("drain() empties the queue's pending jobs", async () => {
    const store = new InMemoryJobStore();
    const queue = new Queue("emails", { store });
    await queue.add("send-welcome", {});

    await queue.drain();

    expect((await queue.getCounts()).waiting).toBe(0);
  });

  it("close() marks the queue closed and rejects further add() calls", async () => {
    const store = new InMemoryJobStore();
    const queue = new Queue("emails", { store });

    await queue.close();

    expect(queue.isClosed).toBe(true);
    await expect(queue.add("send-welcome", {})).rejects.toThrow(/closed/);
  });
});
