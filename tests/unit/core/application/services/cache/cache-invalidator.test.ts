import { describe, expect, it, vi } from "vitest";

import { CacheInvalidator } from "@/application/services/cache/cache-invalidator";
import { CacheKeyBuilder } from "@/application/services/cache/cache-key-builder";
import { CacheStatsCollector } from "@/application/services/cache/cache-stats";
import type { CacheObserver } from "@/application/ports/cache-observer";
import { FakeCacheProvider } from "../../../../../test-utils/fake-cache-provider";

function makeObserver(): CacheObserver & { invalidations: Array<{ namespace: string; scope: string; count: number }> } {
  const invalidations: Array<{ namespace: string; scope: string; count: number }> = [];
  return {
    onHit: vi.fn(),
    onMiss: vi.fn(),
    onSet: vi.fn(),
    onDelete: vi.fn(),
    onInvalidate: vi.fn((event) => invalidations.push({ namespace: event.namespace, scope: event.scope, count: event.count })),
    onError: vi.fn(),
    invalidations,
  };
}

describe("application/services/cache/cache-invalidator", () => {
  it("getVersion() defaults to 1 for a namespace that was never bumped", async () => {
    const invalidator = new CacheInvalidator(new FakeCacheProvider());
    await expect(invalidator.getVersion("ns")).resolves.toBe(1);
  });

  it("bumpVersion() increments and persists the version", async () => {
    const invalidator = new CacheInvalidator(new FakeCacheProvider());
    await expect(invalidator.bumpVersion("ns")).resolves.toBe(2);
    await expect(invalidator.getVersion("ns")).resolves.toBe(2);
    await expect(invalidator.bumpVersion("ns")).resolves.toBe(3);
  });

  it("bumpVersion() best-effort deletes the previous generation's keys", async () => {
    const provider = new FakeCacheProvider();
    const keys = new CacheKeyBuilder();
    const invalidator = new CacheInvalidator(provider, keys);

    await provider.set(keys.build("ns", 1, ["a"]), "1", 5000);
    await provider.set(keys.build("ns", 1, ["b"]), "2", 5000);
    await provider.set(keys.build("ns", 2, ["c"]), "should-survive", 5000);

    const removedCountViaBump = await invalidator.bumpVersion("ns");
    expect(removedCountViaBump).toBe(2); // new version number, not a count

    expect(await provider.get(keys.build("ns", 1, ["a"]))).toBeNull();
    expect(await provider.get(keys.build("ns", 1, ["b"]))).toBeNull();
    expect(await provider.get(keys.build("ns", 2, ["c"]))).toBe("should-survive");
  });

  it("invalidateNamespace() is namespace-wide invalidation via a version bump", async () => {
    const provider = new FakeCacheProvider();
    const keys = new CacheKeyBuilder();
    const invalidator = new CacheInvalidator(provider, keys);

    await provider.set(keys.build("ns", 1, ["a"]), "1", 5000);
    await invalidator.invalidateNamespace("ns");

    expect(await provider.get(keys.build("ns", 1, ["a"]))).toBeNull();
    await expect(invalidator.getVersion("ns")).resolves.toBe(2);
  });

  it("invalidateKey() removes exactly one key", async () => {
    const provider = new FakeCacheProvider();
    const keys = new CacheKeyBuilder();
    const invalidator = new CacheInvalidator(provider, keys);

    await provider.set(keys.build("ns", 1, ["a"]), "1", 5000);
    await provider.set(keys.build("ns", 1, ["b"]), "2", 5000);

    await invalidator.invalidateKey("ns", 1, ["a"]);

    expect(await provider.get(keys.build("ns", 1, ["a"]))).toBeNull();
    expect(await provider.get(keys.build("ns", 1, ["b"]))).toBe("2");
  });

  it("invalidatePattern() removes every key matching a raw wildcard", async () => {
    const provider = new FakeCacheProvider();
    await provider.set("cache:search:madrid", "1", 5000);
    await provider.set("cache:search:sevilla", "2", 5000);
    await provider.set("cache:other:key", "3", 5000);
    const invalidator = new CacheInvalidator(provider);

    const removed = await invalidator.invalidatePattern("cache:search:*");

    expect(removed).toBe(2);
    expect(await provider.get("cache:other:key")).toBe("3");
  });

  it("notifies the observer and records stats on every invalidation", async () => {
    const provider = new FakeCacheProvider();
    const keys = new CacheKeyBuilder();
    const observer = makeObserver();
    const stats = new CacheStatsCollector();
    const invalidator = new CacheInvalidator(provider, keys, observer, stats);

    await provider.set(keys.build("ns", 1, ["a"]), "1", 5000);
    await invalidator.invalidateNamespace("ns");

    expect(observer.onInvalidate).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: "ns", scope: "version", count: 1 }),
    );
    expect(stats.snapshot().invalidations).toBe(1);
  });

  it("a deletePattern() failure is swallowed and reported via onError, not thrown", async () => {
    const provider = new FakeCacheProvider();
    const observer = makeObserver();
    const invalidator = new CacheInvalidator(provider, new CacheKeyBuilder(), observer);

    provider.failNextOperation(new Error("scan failed"));
    const removed = await invalidator.invalidatePattern("cache:*");

    expect(removed).toBe(0);
    expect(observer.onError).toHaveBeenCalled();
  });
});
