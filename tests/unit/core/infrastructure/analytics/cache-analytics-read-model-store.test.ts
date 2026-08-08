import { describe, expect, it, vi } from "vitest";

import { CacheAnalyticsReadModelStore } from "@/infrastructure/analytics/cache-analytics-read-model-store";
import type { CacheNamespace } from "@/application/services/cache/cache-namespace";
import type { AnalyticsDashboardSnapshot } from "@/domain/entities/analytics-dashboard";

function fakeNamespace(): CacheNamespace {
  return {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    has: vi.fn(),
    getOrSet: vi.fn(),
    invalidateAll: vi.fn(),
    name: "analytics-dashboard",
  } as unknown as CacheNamespace;
}

describe("infrastructure/analytics/cache-analytics-read-model-store", () => {
  it("get() returns null on a cache miss", async () => {
    const cache = fakeNamespace();
    (cache.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const store = new CacheAnalyticsReadModelStore(cache);

    await expect(store.get()).resolves.toBeNull();
    expect(cache.get).toHaveBeenCalledWith(["dashboard", "current"]);
  });

  it("set() then get() round-trips a snapshot, converting Date <-> ISO string", async () => {
    const cache = fakeNamespace();
    let stored: unknown = null;
    (cache.set as ReturnType<typeof vi.fn>).mockImplementation(async (_parts: unknown, value: unknown) => {
      stored = value;
    });
    (cache.get as ReturnType<typeof vi.fn>).mockImplementation(async () => stored);

    const store = new CacheAnalyticsReadModelStore(cache);
    const snapshot: AnalyticsDashboardSnapshot = {
      data: null,
      computedAt: new Date("2026-01-01T00:00:00.000Z"),
      source: "live",
      degraded: false,
    };

    await store.set(snapshot, 60_000);
    expect(cache.set).toHaveBeenCalledWith(
      ["dashboard", "current"],
      expect.objectContaining({ computedAt: "2026-01-01T00:00:00.000Z", source: "live" }),
      60_000,
    );

    const roundTripped = await store.get();
    expect(roundTripped).toEqual(snapshot);
  });

  it("invalidate() deletes the single key", async () => {
    const cache = fakeNamespace();
    const store = new CacheAnalyticsReadModelStore(cache);

    await store.invalidate();
    expect(cache.delete).toHaveBeenCalledWith(["dashboard", "current"]);
  });
});
