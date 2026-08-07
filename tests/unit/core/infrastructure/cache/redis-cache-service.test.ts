import { afterEach, describe, expect, it } from "vitest";

import { RedisCacheService } from "@/infrastructure/cache/redis-cache-service";
import { RedisClient } from "@/infrastructure/cache/redis-client";
import { startFakeRedisServer } from "../../../../test-utils/fake-redis-server";
import type { FakeRedisServer } from "../../../../test-utils/fake-redis-server";

describe("infrastructure/cache/redis-cache-service", () => {
  let server: FakeRedisServer;

  afterEach(async () => {
    await server?.close();
  });

  it("round-trips a JSON-serializable value through Redis", async () => {
    server = await startFakeRedisServer();
    const cache = new RedisCacheService(new RedisClient({ url: server.url }));

    await cache.set("user:1", { id: 1, name: "Ana", tags: ["a", "b"] }, 5000);
    await expect(cache.get("user:1")).resolves.toEqual({ id: 1, name: "Ana", tags: ["a", "b"] });
  });

  it("returns null on a miss", async () => {
    server = await startFakeRedisServer();
    const cache = new RedisCacheService(new RedisClient({ url: server.url }));

    await expect(cache.get("missing")).resolves.toBeNull();
  });

  it("sets the key with a PX TTL (visible on the fake server's own store)", async () => {
    server = await startFakeRedisServer();
    const cache = new RedisCacheService(new RedisClient({ url: server.url }));

    await cache.set("k", "v", 5000);
    const entry = server.store.get("k");
    expect(entry?.expiresAt).not.toBeNull();
  });

  it("delete() removes the key", async () => {
    server = await startFakeRedisServer();
    const cache = new RedisCacheService(new RedisClient({ url: server.url }));

    await cache.set("k", "v", 5000);
    await cache.delete("k");
    await expect(cache.get("k")).resolves.toBeNull();
  });

  it("has() reflects EXISTS", async () => {
    server = await startFakeRedisServer();
    const cache = new RedisCacheService(new RedisClient({ url: server.url }));

    await expect(cache.has("k")).resolves.toBe(false);
    await cache.set("k", "v", 5000);
    await expect(cache.has("k")).resolves.toBe(true);
  });

  it("rejects a non-positive ttlMs before ever contacting Redis", async () => {
    server = await startFakeRedisServer();
    const cache = new RedisCacheService(new RedisClient({ url: server.url }));

    await expect(cache.set("k", "v", 0)).rejects.toThrow(RangeError);
  });

  it("treats a value that isn't valid JSON as a cache miss rather than throwing", async () => {
    server = await startFakeRedisServer();
    server.store.set("corrupted", { value: "{not-json", expiresAt: null });
    const cache = new RedisCacheService(new RedisClient({ url: server.url }));

    await expect(cache.get("corrupted")).resolves.toBeNull();
  });
});
