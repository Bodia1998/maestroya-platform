import { afterEach, describe, expect, it, vi } from "vitest";

import { startFakeRedisServer } from "../../../../test-utils/fake-redis-server";
import type { FakeRedisServer } from "../../../../test-utils/fake-redis-server";
import { VALID_BASE_ENV } from "../config/env-fixture";

async function loadFactory(redisUrl: string | undefined) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  if (redisUrl === undefined) delete mutableEnv.REDIS_URL;
  else mutableEnv.REDIS_URL = redisUrl;

  vi.resetModules();
  return Promise.all([
    import("@/infrastructure/locking/lock-service-factory"),
    import("@/infrastructure/locking/in-memory-lock-service"),
    import("@/infrastructure/locking/redis-lock-service"),
  ]);
}

describe("infrastructure/locking/lock-service-factory", () => {
  let server: FakeRedisServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    delete (process.env as Record<string, string | undefined>).REDIS_URL;
  });

  it("returns InMemoryLockService when REDIS_URL is unset", async () => {
    const [{ createDistributedLock }, { InMemoryLockService }] = await loadFactory(undefined);
    expect(createDistributedLock()).toBeInstanceOf(InMemoryLockService);
  });

  it("returns RedisLockService when REDIS_URL is configured", async () => {
    server = await startFakeRedisServer();
    const [{ createDistributedLock }, , { RedisLockService }] = await loadFactory(server.url);
    expect(createDistributedLock()).toBeInstanceOf(RedisLockService);
  });

  it("memoizes a single instance per process", async () => {
    const [{ createDistributedLock }] = await loadFactory(undefined);
    expect(createDistributedLock()).toBe(createDistributedLock());
  });
});
