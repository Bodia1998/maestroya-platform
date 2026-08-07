import { afterEach, describe, expect, it, vi } from "vitest";

import { startFakeRedisServer } from "../../../../test-utils/fake-redis-server";
import type { FakeRedisServer } from "../../../../test-utils/fake-redis-server";
import { VALID_BASE_ENV } from "../config/env-fixture";

/**
 * Module 46 — Caching Layer.
 *
 * Same `vi.resetModules()` + dynamic-import pattern as Module 44's own
 * `cache-service-factory.test.ts` — `createCacheProvider()` memoizes a
 * module-level singleton, so each case needs a fresh module graph to
 * observe a different `REDIS_URL`.
 */
async function loadFactory(redisUrl: string | undefined) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  if (redisUrl === undefined) delete mutableEnv.REDIS_URL;
  else mutableEnv.REDIS_URL = redisUrl;

  vi.resetModules();
  return Promise.all([
    import("@/infrastructure/cache/cache-provider-factory"),
    import("@/infrastructure/cache/in-memory-cache-provider"),
    import("@/infrastructure/cache/redis-cache-provider"),
  ]);
}

describe("infrastructure/cache/cache-provider-factory", () => {
  let server: FakeRedisServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    delete (process.env as Record<string, string | undefined>).REDIS_URL;
  });

  it("returns an InMemoryCacheProvider when REDIS_URL is unset", async () => {
    const [{ createCacheProvider }, { InMemoryCacheProvider }] = await loadFactory(undefined);
    expect(createCacheProvider()).toBeInstanceOf(InMemoryCacheProvider);
  });

  it("returns a RedisCacheProvider when REDIS_URL is configured", async () => {
    server = await startFakeRedisServer();
    const [{ createCacheProvider }, , { RedisCacheProvider }] = await loadFactory(server.url);
    expect(createCacheProvider()).toBeInstanceOf(RedisCacheProvider);
  });

  it("memoizes a single instance per process", async () => {
    const [{ createCacheProvider }] = await loadFactory(undefined);
    expect(createCacheProvider()).toBe(createCacheProvider());
  });
});
