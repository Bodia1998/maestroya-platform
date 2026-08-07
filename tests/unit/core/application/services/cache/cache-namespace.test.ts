import { describe, expect, it, vi } from "vitest";

import { CacheManager } from "@/application/services/cache/cache-manager";
import { FakeCacheProvider } from "../../../../../test-utils/fake-cache-provider";

describe("application/services/cache/cache-namespace", () => {
  it("exposes the namespace name it was created for", () => {
    const manager = new CacheManager(new FakeCacheProvider());
    expect(manager.namespace("professionals").name).toBe("professionals");
  });

  it("get/set/delete/has delegate to the owning manager scoped to this namespace", async () => {
    const manager = new CacheManager(new FakeCacheProvider());
    const ns = manager.namespace("professionals");

    await ns.set(["1"], { id: 1 }, 5000);
    await expect(ns.get(["1"])).resolves.toEqual({ id: 1 });
    await expect(ns.has(["1"])).resolves.toBe(true);
    await ns.delete(["1"]);
    await expect(ns.get(["1"])).resolves.toBeNull();
  });

  it("getOrSet performs read-through caching scoped to this namespace", async () => {
    const manager = new CacheManager(new FakeCacheProvider());
    const ns = manager.namespace("professionals");
    const loader = vi.fn().mockResolvedValue("computed");

    await ns.getOrSet(["k"], 5000, loader);
    await ns.getOrSet(["k"], 5000, loader);

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("invalidateAll clears this namespace without touching another one", async () => {
    const manager = new CacheManager(new FakeCacheProvider());
    const a = manager.namespace("ns-a");
    const b = manager.namespace("ns-b");

    await a.set(["k"], "1", 5000);
    await b.set(["k"], "2", 5000);

    await a.invalidateAll();

    await expect(a.get(["k"])).resolves.toBeNull();
    await expect(b.get(["k"])).resolves.toBe("2");
  });
});
