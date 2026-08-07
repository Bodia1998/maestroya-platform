import { describe, expect, it } from "vitest";

import { InMemoryJobStore } from "@/infrastructure/jobs/in-memory-job-store";
import { Queue } from "@/infrastructure/jobs/queue";
import { SearchIndexQueueAdapter } from "@/infrastructure/search/search-index-queue-adapter";
import type { SearchIndexJobData } from "@/infrastructure/search/search-index-jobs";

describe("infrastructure/search/search-index-queue-adapter", () => {
  it("enqueues a job with the configured backoff options and a deterministic job id", async () => {
    const store = new InMemoryJobStore();
    const queue = new Queue<SearchIndexJobData>("search-index", { store });
    const adapter = new SearchIndexQueueAdapter(queue, {
      attempts: 5,
      backoff: { type: "exponential", delay: 1000, jitter: 0.2 },
    });

    await adapter.enqueue({ operation: "index", kind: "PROFESSIONAL", entityId: "p1", eventId: "evt-1" });

    const counts = await queue.getCounts();
    expect(counts.waiting).toBe(1);

    const job = await store.reserve("search-index", Date.now());
    expect(job?.data).toEqual({
      operation: "index",
      kind: "PROFESSIONAL",
      entityId: "p1",
      eventId: "evt-1",
      reason: undefined,
    });
    expect(job?.opts.attempts).toBe(5);
    expect(job?.id).toBe("search:index:PROFESSIONAL:p1:evt-1");
  });

  it("a duplicate request (same job id) is silently coalesced, not an error", async () => {
    const store = new InMemoryJobStore();
    const queue = new Queue<SearchIndexJobData>("search-index", { store });
    const adapter = new SearchIndexQueueAdapter(queue, { attempts: 3 });
    const request = { operation: "index" as const, kind: "PROFESSIONAL" as const, entityId: "p1", eventId: "evt-1" };

    await adapter.enqueue(request);
    await expect(adapter.enqueue(request)).resolves.toBeUndefined();

    expect((await queue.getCounts()).waiting).toBe(1);
  });
});
