import { describe, expect, it, vi } from "vitest";

import { CacheManager } from "@/application/services/cache/cache-manager";
import { FakeCacheProvider } from "../../../../../test-utils/fake-cache-provider";

describe("application/services/cache/cache-manager", () => {
  it("get() returns null on a miss", async () => {
    const manager = new CacheManager(new FakeCacheProvider());
    await expect(manager.get("ns", ["k"])).resolves.toBeNull();
  });

  it("set() then get() round-trips a value", async () => {
    const manager = new CacheManager(new FakeCacheProvider());
    await manager.set("ns", ["k"], { hello: "world" }, 5000);
    await expect(manager.get("ns", ["k"])).resolves.toEqual({ hello: "world" });
  });

  it("delete() removes a previously set value", async () => {
    const manager = new CacheManager(new FakeCacheProvider());
    await manager.set("ns", ["k"], "v", 5000);
    await manager.delete("ns", ["k"]);
    await expect(manager.get("ns", ["k"])).resolves.toBeNull();
  });

  it("has() reflects presence", async () => {
    const manager = new CacheManager(new FakeCacheProvider());
    await expect(manager.has("ns", ["k"])).resolves.toBe(false);
    await manager.set("ns", ["k"], "v", 5000);
    await expect(manager.has("ns", ["k"])).resolves.toBe(true);
  });

  it("different namespaces never collide on the same key parts", async () => {
    const manager = new CacheManager(new FakeCacheProvider());
    await manager.set("ns-a", ["k"], "a", 5000);
    await manager.set("ns-b", ["k"], "b", 5000);
    await expect(manager.get("ns-a", ["k"])).resolves.toBe("a");
    await expect(manager.get("ns-b", ["k"])).resolves.toBe("b");
  });

  describe("getOrSet (read-through)", () => {
    it("calls the loader on a miss and caches its result", async () => {
      const manager = new CacheManager(new FakeCacheProvider());
      const loader = vi.fn().mockResolvedValue("computed");

      const result = await manager.getOrSet("ns", ["k"], 5000, loader);

      expect(result).toBe("computed");
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("returns the cached value on a subsequent call without calling the loader again", async () => {
      const manager = new CacheManager(new FakeCacheProvider());
      const loader = vi.fn().mockResolvedValue("computed");

      await manager.getOrSet("ns", ["k"], 5000, loader);
      const second = await manager.getOrSet("ns", ["k"], 5000, loader);

      expect(second).toBe("computed");
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("propagates the loader's error and never caches a failed computation", async () => {
      const manager = new CacheManager(new FakeCacheProvider());
      const loader = vi.fn().mockRejectedValue(new Error("boom"));

      await expect(manager.getOrSet("ns", ["k"], 5000, loader)).rejects.toThrow("boom");
      expect(await manager.has("ns", ["k"])).toBe(false);
    });
  });

  describe("bypass", () => {
    it("manager-level bypass always re-runs the loader, but still writes the fresh value", async () => {
      const manager = new CacheManager(new FakeCacheProvider(), { bypass: true });
      const loader = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");

      await expect(manager.getOrSet("ns", ["k"], 5000, loader)).resolves.toBe("first");
      await expect(manager.getOrSet("ns", ["k"], 5000, loader)).resolves.toBe("second");
      expect(loader).toHaveBeenCalledTimes(2);
    });

    it("a per-call bypass option overrides a non-bypassing manager", async () => {
      const manager = new CacheManager(new FakeCacheProvider());
      const loader = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");

      await manager.getOrSet("ns", ["k"], 5000, loader);
      const result = await manager.getOrSet("ns", ["k"], 5000, loader, { bypass: true });

      expect(result).toBe("second");
      expect(loader).toHaveBeenCalledTimes(2);
    });

    it("a function-valued bypass option is evaluated per call", async () => {
      let enabled = false;
      const manager = new CacheManager(new FakeCacheProvider(), { bypass: () => enabled });
      const loader = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");

      await manager.getOrSet("ns", ["k"], 5000, loader);
      enabled = true;
      const result = await manager.getOrSet("ns", ["k"], 5000, loader);

      expect(result).toBe("second");
    });
  });

  describe("versioning and namespace-wide invalidation", () => {
    it("invalidateNamespace makes every previously cached key unreachable", async () => {
      const manager = new CacheManager(new FakeCacheProvider());
      await manager.set("ns", ["a"], "1", 5000);
      await manager.set("ns", ["b"], "2", 5000);

      await manager.invalidator.invalidateNamespace("ns");

      await expect(manager.get("ns", ["a"])).resolves.toBeNull();
      await expect(manager.get("ns", ["b"])).resolves.toBeNull();
    });

    it("invalidateNamespace does not affect a different namespace", async () => {
      const manager = new CacheManager(new FakeCacheProvider());
      await manager.set("ns-a", ["a"], "1", 5000);
      await manager.set("ns-b", ["a"], "2", 5000);

      await manager.invalidator.invalidateNamespace("ns-a");

      await expect(manager.get("ns-a", ["a"])).resolves.toBeNull();
      await expect(manager.get("ns-b", ["a"])).resolves.toBe("2");
    });

    it("a namespace can be reused (re-populated) after invalidation", async () => {
      const manager = new CacheManager(new FakeCacheProvider());
      await manager.set("ns", ["a"], "1", 5000);
      await manager.invalidator.invalidateNamespace("ns");
      await manager.set("ns", ["a"], "2", 5000);
      await expect(manager.get("ns", ["a"])).resolves.toBe("2");
    });
  });

  describe("statistics", () => {
    it("tracks hits, misses, sets, deletes, and invalidations with a correct hit ratio", async () => {
      const manager = new CacheManager(new FakeCacheProvider());

      await manager.get("ns", ["missing"]); // miss
      await manager.set("ns", ["k"], "v", 5000); // set
      await manager.get("ns", ["k"]); // hit
      await manager.get("ns", ["k"]); // hit
      await manager.delete("ns", ["k"]); // delete
      await manager.invalidator.invalidateNamespace("ns"); // invalidation

      const stats = manager.getStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(2);
      expect(stats.sets).toBe(1);
      expect(stats.deletes).toBe(1);
      expect(stats.hitRatio).toBeCloseTo(2 / 3);
    });

    it("hitRatio is 0 with no reads at all", () => {
      const manager = new CacheManager(new FakeCacheProvider());
      expect(manager.getStats().hitRatio).toBe(0);
    });
  });

  describe("provider error handling", () => {
    it("get() degrades to a miss (not a throw) when the provider's version lookup fails", async () => {
      const provider = new FakeCacheProvider();
      const manager = new CacheManager(provider);
      provider.failNextOperation(new Error("provider down"));

      await expect(manager.get("ns", ["k"])).resolves.toBeNull();
      expect(manager.getStats().errors).toBe(1);
    });

    it("get() degrades to a miss (not a throw) when the provider's own get() fails", async () => {
      const provider = new FakeCacheProvider();
      const manager = new CacheManager(provider);
      // First failure is consumed by the internal version lookup
      // (`invalidator.getVersion`'s own `provider.get`); the second
      // reaches the actual `provider.get(key)` this test targets.
      provider.failNextOperation(new Error("version lookup down"));
      provider.failNextOperation(new Error("provider down"));

      await expect(manager.get("ns", ["k"])).resolves.toBeNull();
      expect(manager.getStats().errors).toBe(2);
    });

    it("has() degrades to false when the provider fails", async () => {
      const provider = new FakeCacheProvider();
      const manager = new CacheManager(provider);
      provider.failNextOperation(new Error("version lookup down"));
      provider.failNextOperation(new Error("provider down"));

      await expect(manager.has("ns", ["k"])).resolves.toBe(false);
    });

    it("set() rethrows the provider's error rather than silently swallowing a write failure", async () => {
      const provider = new FakeCacheProvider();
      const manager = new CacheManager(provider);
      provider.failNextOperation(new Error("version lookup down"));
      provider.failNextOperation(new Error("write failed"));

      await expect(manager.set("ns", ["k"], "v", 5000)).rejects.toThrow("write failed");
    });
  });
});
