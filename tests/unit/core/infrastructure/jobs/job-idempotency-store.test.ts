import { describe, expect, it, vi } from "vitest";

import { InMemoryJobIdempotencyStore } from "@/infrastructure/jobs/job-idempotency-store";

describe("infrastructure/jobs/job-idempotency-store (InMemoryJobIdempotencyStore)", () => {
  it("a key is not processed until markProcessed is called", async () => {
    const store = new InMemoryJobIdempotencyStore();
    expect(await store.isProcessed("k")).toBe(false);
  });

  it("markProcessed makes isProcessed true", async () => {
    const store = new InMemoryJobIdempotencyStore();
    await store.markProcessed("k", 60_000);
    expect(await store.isProcessed("k")).toBe(true);
  });

  it("a key expires after its TTL", async () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryJobIdempotencyStore();
      await store.markProcessed("k", 1000);
      expect(await store.isProcessed("k")).toBe(true);

      vi.advanceTimersByTime(1001);
      expect(await store.isProcessed("k")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("different keys are independent", async () => {
    const store = new InMemoryJobIdempotencyStore();
    await store.markProcessed("a", 60_000);
    expect(await store.isProcessed("a")).toBe(true);
    expect(await store.isProcessed("b")).toBe(false);
  });
});
