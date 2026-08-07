import { describe, expect, it, vi } from "vitest";

import { InMemoryCacheProvider } from "@/infrastructure/cache/in-memory-cache-provider";

describe("infrastructure/cache/in-memory-cache-provider", () => {
  it("returns null on a miss", async () => {
    const cache = new InMemoryCacheProvider();
    await expect(cache.get("missing")).resolves.toBeNull();
  });

  it("round-trips a value through set/get", async () => {
    const cache = new InMemoryCacheProvider();
    await cache.set("k", { a: 1 }, 5000);
    await expect(cache.get("k")).resolves.toEqual({ a: 1 });
  });

  it("expires a value after its TTL elapses", async () => {
    vi.useFakeTimers();
    try {
      const cache = new InMemoryCacheProvider();
      await cache.set("k", "v", 1000);
      vi.advanceTimersByTime(1001);
      await expect(cache.get("k")).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a non-positive ttlMs", async () => {
    const cache = new InMemoryCacheProvider();
    await expect(cache.set("k", "v", 0)).rejects.toThrow(RangeError);
  });

  it("delete() removes a key", async () => {
    const cache = new InMemoryCacheProvider();
    await cache.set("k", "v", 5000);
    await cache.delete("k");
    await expect(cache.get("k")).resolves.toBeNull();
  });

  it("has() reflects presence and expiry", async () => {
    const cache = new InMemoryCacheProvider();
    await expect(cache.has("k")).resolves.toBe(false);
    await cache.set("k", "v", 5000);
    await expect(cache.has("k")).resolves.toBe(true);
  });

  describe("deletePattern", () => {
    it("removes every key matching a *-glob", async () => {
      const cache = new InMemoryCacheProvider();
      await cache.set("cache:ns:v1:a", "1", 5000);
      await cache.set("cache:ns:v1:b", "2", 5000);
      await cache.set("cache:other:v1:c", "3", 5000);

      const removed = await cache.deletePattern("cache:ns:v1:*");

      expect(removed).toBe(2);
      expect(cache.size()).toBe(1);
      await expect(cache.get("cache:other:v1:c")).resolves.toBe("3");
    });

    it("returns 0 when nothing matches", async () => {
      const cache = new InMemoryCacheProvider();
      await cache.set("k", "v", 5000);
      await expect(cache.deletePattern("nope:*")).resolves.toBe(0);
    });

    it("an exact pattern with no wildcard matches only that key", async () => {
      const cache = new InMemoryCacheProvider();
      await cache.set("exact", "v", 5000);
      await cache.set("exact2", "v", 5000);
      await expect(cache.deletePattern("exact")).resolves.toBe(1);
    });
  });
});
