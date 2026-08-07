import { afterEach, describe, expect, it, vi } from "vitest";

import { VALID_BASE_ENV } from "../config/env-fixture";

async function loadFactory(redisUrl: string | undefined) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  if (redisUrl === undefined) delete mutableEnv.REDIS_URL;
  else mutableEnv.REDIS_URL = redisUrl;

  vi.resetModules();
  return Promise.all([
    import("@/infrastructure/cache/redis-client-factory"),
    import("@/infrastructure/cache/redis-client"),
  ]);
}

describe("infrastructure/cache/redis-client-factory", () => {
  afterEach(() => {
    delete (process.env as Record<string, string | undefined>).REDIS_URL;
  });

  it("returns null when REDIS_URL is unset", async () => {
    const [{ getRedisClient }] = await loadFactory(undefined);
    expect(getRedisClient()).toBeNull();
  });

  it("returns a RedisClient instance when REDIS_URL is set", async () => {
    const [{ getRedisClient }, { RedisClient }] = await loadFactory("redis://localhost:6379");
    expect(getRedisClient()).toBeInstanceOf(RedisClient);
  });

  it("memoizes the same instance (including the null case) per process", async () => {
    const [{ getRedisClient: getUnset }] = await loadFactory(undefined);
    expect(getUnset()).toBe(getUnset());

    const [{ getRedisClient: getSet }] = await loadFactory("redis://localhost:6379");
    expect(getSet()).toBe(getSet());
  });
});
