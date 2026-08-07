import { afterEach, describe, expect, it, vi } from "vitest";

import { startFakeRedisServer } from "../../../../test-utils/fake-redis-server";
import type { FakeRedisServer } from "../../../../test-utils/fake-redis-server";
import { VALID_BASE_ENV } from "../config/env-fixture";

/**
 * Module 44 — Redis Infrastructure.
 *
 * Same `vi.resetModules()` + dynamic-import pattern as
 * `geocoding-provider-factory.test.ts`/`error-reporter-factory.test.ts` —
 * `getRedisClient()`/`createCacheService()` memoize a module-level
 * singleton, so each case needs a fresh module graph to observe a
 * different `REDIS_URL`.
 */
async function loadFactory(redisUrl: string | undefined) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  if (redisUrl === undefined) delete mutableEnv.REDIS_URL;
  else mutableEnv.REDIS_URL = redisUrl;

  vi.resetModules();
  return Promise.all([
    import("@/infrastructure/cache/cache-service-factory"),
    import("@/infrastructure/cache/in-memory-cache-service"),
    import("@/infrastructure/cache/redis-cache-service"),
  ]);
}

describe("infrastructure/cache/cache-service-factory", () => {
  let server: FakeRedisServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    delete (process.env as Record<string, string | undefined>).REDIS_URL;
  });

  it("returns an InMemoryCacheService when REDIS_URL is unset", async () => {
    const [{ createCacheService }, { InMemoryCacheService }] = await loadFactory(undefined);
    expect(createCacheService()).toBeInstanceOf(InMemoryCacheService);
  });

  it("returns a RedisCacheService when REDIS_URL is configured", async () => {
    server = await startFakeRedisServer();
    const [{ createCacheService }, , { RedisCacheService }] = await loadFactory(server.url);
    expect(createCacheService()).toBeInstanceOf(RedisCacheService);
  });

  it("memoizes a single instance per process", async () => {
    const [{ createCacheService }] = await loadFactory(undefined);
    expect(createCacheService()).toBe(createCacheService());
  });
});
