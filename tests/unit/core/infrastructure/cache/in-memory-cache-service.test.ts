import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryCacheService } from "@/infrastructure/cache/in-memory-cache-service";

describe("infrastructure/cache/in-memory-cache-service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for a key that was never set", async () => {
    const cache = new InMemoryCacheService();
    await expect(cache.get("missing")).resolves.toBeNull();
  });

  it("stores and retrieves typed values", async () => {
    const cache = new InMemoryCacheService();
    await cache.set("user:1", { id: 1, name: "Ana" }, 1000);

    await expect(cache.get<{ id: number; name: string }>("user:1")).resolves.toEqual({
      id: 1,
      name: "Ana",
    });
  });

  it("expires a value after its ttlMs elapses", async () => {
    const cache = new InMemoryCacheService();
    await cache.set("k", "v", 1000);

    vi.advanceTimersByTime(999);
    await expect(cache.get("k")).resolves.toBe("v");

    vi.advanceTimersByTime(2);
    await expect(cache.get("k")).resolves.toBeNull();
  });

  it("reclaims an expired entry's storage slot on the next access", async () => {
    const cache = new InMemoryCacheService();
    await cache.set("k", "v", 1000);
    expect(cache.size()).toBe(1);

    vi.advanceTimersByTime(1001);
    await cache.get("k");

    expect(cache.size()).toBe(0);
  });

  it("delete() removes a key; is a no-op for an absent key", async () => {
    const cache = new InMemoryCacheService();
    await cache.set("k", "v", 1000);
    await cache.delete("k");
    await expect(cache.get("k")).resolves.toBeNull();

    await expect(cache.delete("never-existed")).resolves.toBeUndefined();
  });

  it("has() reflects expiry, not just presence", async () => {
    const cache = new InMemoryCacheService();
    await cache.set("k", "v", 1000);
    await expect(cache.has("k")).resolves.toBe(true);

    vi.advanceTimersByTime(1001);
    await expect(cache.has("k")).resolves.toBe(false);
  });

  it("rejects a non-positive ttlMs", async () => {
    const cache = new InMemoryCacheService();
    await expect(cache.set("k", "v", 0)).rejects.toThrow(RangeError);
    await expect(cache.set("k", "v", -5)).rejects.toThrow(RangeError);
  });

  it("overwriting a key resets its TTL to the new value's", async () => {
    const cache = new InMemoryCacheService();
    await cache.set("k", "v1", 1000);
    vi.advanceTimersByTime(900);
    await cache.set("k", "v2", 1000);
    vi.advanceTimersByTime(900);

    // Would have expired under the *first* TTL by now, but not the second.
    await expect(cache.get("k")).resolves.toBe("v2");
  });
});
