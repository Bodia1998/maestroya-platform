import { describe, expect, it } from "vitest";

import { InMemoryJobStore } from "@/infrastructure/jobs/in-memory-job-store";
import type { StoredJob } from "@/infrastructure/jobs/job-types";
import { DEFAULT_BACKOFF } from "@/infrastructure/jobs/job-types";

function makeJob(overrides: Partial<StoredJob> = {}): StoredJob {
  return {
    id: overrides.id ?? "job-1",
    queue: "q",
    name: "do-thing",
    data: { foo: "bar" },
    opts: { attempts: 3, backoff: DEFAULT_BACKOFF },
    attemptsMade: 0,
    createdAt: 1000,
    processAt: 1000,
    ...overrides,
  };
}

describe("infrastructure/jobs/in-memory-job-store", () => {
  it("add() then reserve() returns the job once it is due", async () => {
    const store = new InMemoryJobStore();
    await store.add(makeJob({ processAt: 1000 }));

    expect(await store.reserve("q", 999)).toBeNull();
    const reserved = await store.reserve("q", 1000);
    expect(reserved?.id).toBe("job-1");
    expect(reserved?.attemptsMade).toBe(1);
  });

  it("de-duplicates by job id: a second add() with the same id is a no-op", async () => {
    const store = new InMemoryJobStore();
    const first = await store.add(makeJob({ id: "dup" }));
    const second = await store.add(makeJob({ id: "dup", data: { foo: "different" } }));

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect((await store.counts("q", 1000)).waiting).toBe(1);
  });

  it("reserve() returns the earliest-due job first (FIFO among due jobs)", async () => {
    const store = new InMemoryJobStore();
    await store.add(makeJob({ id: "later", processAt: 2000 }));
    await store.add(makeJob({ id: "earlier", processAt: 1000 }));

    const reserved = await store.reserve("q", 5000);
    expect(reserved?.id).toBe("earlier");
  });

  it("reserve() returns null when nothing is due yet", async () => {
    const store = new InMemoryJobStore();
    await store.add(makeJob({ processAt: 5000 }));
    expect(await store.reserve("q", 1000)).toBeNull();
  });

  it("complete() removes the job from active and increments the completed counter", async () => {
    const store = new InMemoryJobStore();
    await store.add(makeJob());
    const job = (await store.reserve("q", 1000))!;
    await store.complete(job);

    const counts = await store.counts("q", 1000);
    expect(counts.active).toBe(0);
    expect(counts.completed).toBe(1);
  });

  it("retry() moves the job back to pending at the new processAt", async () => {
    const store = new InMemoryJobStore();
    await store.add(makeJob());
    const job = (await store.reserve("q", 1000))!;
    await store.retry(job, 5000, "boom");

    expect(await store.reserve("q", 4999)).toBeNull();
    const retried = await store.reserve("q", 5000);
    expect(retried?.failedReason).toBe("boom");
  });

  it("fail() removes the job from active and increments the failed counter", async () => {
    const store = new InMemoryJobStore();
    await store.add(makeJob());
    const job = (await store.reserve("q", 1000))!;
    await store.fail(job, "exhausted");

    const counts = await store.counts("q", 1000);
    expect(counts.active).toBe(0);
    expect(counts.failed).toBe(1);
  });

  it("counts() splits waiting (due) from delayed (not yet due)", async () => {
    const store = new InMemoryJobStore();
    await store.add(makeJob({ id: "due", processAt: 1000 }));
    await store.add(makeJob({ id: "future", processAt: 9000 }));

    const counts = await store.counts("q", 5000);
    expect(counts.waiting).toBe(1);
    expect(counts.delayed).toBe(1);
  });

  it("drain() discards every pending job in a queue without touching active jobs", async () => {
    const store = new InMemoryJobStore();
    await store.add(makeJob({ id: "pending-1" }));
    const reservedFirst = await store.add(makeJob({ id: "to-reserve" }));
    expect(reservedFirst).not.toBeNull();
    const active = await store.reserve("q", 1000);

    await store.drain("q");

    const counts = await store.counts("q", 1000);
    expect(counts.waiting).toBe(0);
    expect(counts.delayed).toBe(0);
    expect(counts.active).toBe(1);
    expect(active?.id).toBe("pending-1");
  });

  it("reserve() is a race two concurrent workers can never both win", async () => {
    const store = new InMemoryJobStore();
    await store.add(makeJob());

    const [a, b] = await Promise.all([store.reserve("q", 1000), store.reserve("q", 1000)]);
    const winners = [a, b].filter((job) => job !== null);
    expect(winners).toHaveLength(1);
  });
});
