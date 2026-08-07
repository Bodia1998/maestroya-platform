import { afterEach, describe, expect, it } from "vitest";

import { RedisCacheProvider } from "@/infrastructure/cache/redis-cache-provider";
import { RedisClient } from "@/infrastructure/cache/redis-client";
import { startFakeRedisServer } from "../../../../test-utils/fake-redis-server";
import type { FakeRedisServer } from "../../../../test-utils/fake-redis-server";

describe("infrastructure/cache/redis-cache-provider", () => {
  let server: FakeRedisServer;

  afterEach(async () => {
    await server?.close();
  });

  it("round-trips a JSON-serializable value through Redis", async () => {
    server = await startFakeRedisServer();
    const cache = new RedisCacheProvider(new RedisClient({ url: server.url }));

    await cache.set("user:1", { id: 1, name: "Ana" }, 5000);
    await expect(cache.get("user:1")).resolves.toEqual({ id: 1, name: "Ana" });
  });

  it("returns null on a miss", async () => {
    server = await startFakeRedisServer();
    const cache = new RedisCacheProvider(new RedisClient({ url: server.url }));
    await expect(cache.get("missing")).resolves.toBeNull();
  });

  it("delete() removes the key", async () => {
    server = await startFakeRedisServer();
    const cache = new RedisCacheProvider(new RedisClient({ url: server.url }));
    await cache.set("k", "v", 5000);
    await cache.delete("k");
    await expect(cache.get("k")).resolves.toBeNull();
  });

  it("has() reflects EXISTS", async () => {
    server = await startFakeRedisServer();
    const cache = new RedisCacheProvider(new RedisClient({ url: server.url }));
    await expect(cache.has("k")).resolves.toBe(false);
    await cache.set("k", "v", 5000);
    await expect(cache.has("k")).resolves.toBe(true);
  });

  it("rejects a non-positive ttlMs before ever contacting Redis", async () => {
    server = await startFakeRedisServer();
    const cache = new RedisCacheProvider(new RedisClient({ url: server.url }));
    await expect(cache.set("k", "v", 0)).rejects.toThrow(RangeError);
  });

  it("treats a value that isn't valid JSON as a cache miss rather than throwing", async () => {
    server = await startFakeRedisServer();
    server.store.set("corrupted", { value: "{not-json", expiresAt: null });
    const cache = new RedisCacheProvider(new RedisClient({ url: server.url }));
    await expect(cache.get("corrupted")).resolves.toBeNull();
  });

  describe("deletePattern (SCAN + DEL)", () => {
    it("removes every key matching a *-glob and leaves others intact", async () => {
      server = await startFakeRedisServer();
      const cache = new RedisCacheProvider(new RedisClient({ url: server.url }));

      await cache.set("cache:ns:v1:a", "1", 5000);
      await cache.set("cache:ns:v1:b", "2", 5000);
      await cache.set("cache:other:v1:c", "3", 5000);

      const removed = await cache.deletePattern("cache:ns:v1:*");

      expect(removed).toBe(2);
      await expect(cache.get("cache:ns:v1:a")).resolves.toBeNull();
      await expect(cache.get("cache:ns:v1:b")).resolves.toBeNull();
      await expect(cache.get("cache:other:v1:c")).resolves.toBe("3");
    });

    it("returns 0 when nothing matches, without error", async () => {
      server = await startFakeRedisServer();
      const cache = new RedisCacheProvider(new RedisClient({ url: server.url }));
      await expect(cache.deletePattern("nothing:matches:*")).resolves.toBe(0);
    });
  });
});
