import { afterEach, describe, expect, it, vi } from "vitest";

import { startFakeRedisServer } from "../../test-utils/fake-redis-server";
import type { FakeRedisServer } from "../../test-utils/fake-redis-server";
import { VALID_BASE_ENV } from "../../unit/core/infrastructure/config/env-fixture";

/**
 * Module 46 — Caching Layer (Roadmap Module 13).
 *
 * End-to-end integration coverage across the full stack this module
 * adds: `CacheManager` → `CacheProvider` → real Redis wire protocol
 * (via the same in-process fake Redis server Module 44's own integration
 * tests use — see `tests/test-utils/fake-redis-server.ts`). Exercises
 * read-through caching, namespace-wide invalidation via version bump,
 * and wildcard invalidation, all against a real `RedisCacheProvider`
 * rather than the in-memory fake used by the application-layer unit
 * tests (`tests/unit/core/application/services/cache/`).
 */
async function loadCacheModule(redisUrl: string) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  mutableEnv.REDIS_URL = redisUrl;

  vi.resetModules();
  return import("@/infrastructure/cache/compose");
}

describe("Module 46 — Caching Layer: Redis-backed integration flows", () => {
  let server: FakeRedisServer;

  afterEach(async () => {
    await server?.close();
    delete (process.env as Record<string, string | undefined>).REDIS_URL;
  });

  it("read-through caching: the loader runs once, Redis serves every subsequent read", async () => {
    server = await startFakeRedisServer();
    const { getCacheNamespace } = await loadCacheModule(server.url);
    const professionals = getCacheNamespace("professionals");
    const loader = vi.fn().mockResolvedValue({ id: "p1", name: "Ana" });

    const first = await professionals.getOrSet(["profile", "p1"], 60_000, loader);
    const second = await professionals.getOrSet(["profile", "p1"], 60_000, loader);

    expect(first).toEqual({ id: "p1", name: "Ana" });
    expect(second).toEqual({ id: "p1", name: "Ana" });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("namespace-wide invalidation forces the next read to recompute", async () => {
    server = await startFakeRedisServer();
    const { getCacheNamespace, getCacheManager } = await loadCacheModule(server.url);
    const professionals = getCacheNamespace("professionals");
    const loader = vi.fn().mockResolvedValueOnce("v1").mockResolvedValueOnce("v2");

    await professionals.getOrSet(["profile", "p1"], 60_000, loader);
    await professionals.invalidateAll();
    const afterInvalidation = await professionals.getOrSet(["profile", "p1"], 60_000, loader);

    expect(afterInvalidation).toBe("v2");
    expect(loader).toHaveBeenCalledTimes(2);
    expect(getCacheManager().getStats().invalidations).toBeGreaterThan(0);
  });

  it("invalidating one namespace leaves an unrelated namespace's cached data intact", async () => {
    server = await startFakeRedisServer();
    const { getCacheNamespace } = await loadCacheModule(server.url);
    const professionals = getCacheNamespace("professionals");
    const requests = getCacheNamespace("service-requests");

    await professionals.set(["p1"], "professional-data", 60_000);
    await requests.set(["r1"], "request-data", 60_000);

    await professionals.invalidateAll();

    await expect(professionals.get(["p1"])).resolves.toBeNull();
    await expect(requests.get(["r1"])).resolves.toBe("request-data");
  });

  it("wildcard invalidation via the invalidator removes matching keys directly in Redis", async () => {
    server = await startFakeRedisServer();
    const { getCacheManager } = await loadCacheModule(server.url);
    const manager = getCacheManager();

    await manager.set("search", ["madrid", "page-1"], "results-1", 60_000);
    await manager.set("search", ["madrid", "page-2"], "results-2", 60_000);
    await manager.set("search", ["sevilla", "page-1"], "results-3", 60_000);

    const removed = await manager.invalidator.invalidatePattern("cache:search:v1:madrid:*");

    expect(removed).toBe(2);
    await expect(manager.get("search", ["madrid", "page-1"])).resolves.toBeNull();
    await expect(manager.get("search", ["sevilla", "page-1"])).resolves.toBe("results-3");
  });

  it("cache bypass (CACHE_BYPASS_ENABLED) always recomputes while keeping Redis warm for other readers", async () => {
    server = await startFakeRedisServer();
    const mutableEnv = process.env as Record<string, string | undefined>;
    for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
    mutableEnv.REDIS_URL = server.url;
    mutableEnv.CACHE_BYPASS_ENABLED = "true";
    vi.resetModules();
    const { getCacheNamespace } = await import("@/infrastructure/cache/compose");

    const ns = getCacheNamespace("bypassed");
    const loader = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");

    await expect(ns.getOrSet(["k"], 60_000, loader)).resolves.toBe("first");
    await expect(ns.getOrSet(["k"], 60_000, loader)).resolves.toBe("second");
    expect(loader).toHaveBeenCalledTimes(2);

    delete mutableEnv.CACHE_BYPASS_ENABLED;
  });

  it("getCacheHealth() reflects the redis driver and live hit/miss statistics", async () => {
    server = await startFakeRedisServer();
    const { getCacheHealth, getCacheNamespace } = await loadCacheModule(server.url);
    const ns = getCacheNamespace("ns");

    await ns.get(["missing"]);
    await ns.set(["k"], "v", 60_000);
    await ns.get(["k"]);

    const health = getCacheHealth();
    expect(health.driver).toBe("redis");
    expect(health.status).toBe("ok");
    expect(health.stats.hits).toBe(1);
    expect(health.stats.misses).toBe(1);
  });
});
