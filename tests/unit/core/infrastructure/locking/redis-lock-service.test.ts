import { afterEach, describe, expect, it, vi } from "vitest";

import { RedisLockService } from "@/infrastructure/locking/redis-lock-service";
import { RedisClient } from "@/infrastructure/cache/redis-client";
import { startFakeRedisServer } from "../../../../test-utils/fake-redis-server";
import type { FakeRedisServer } from "../../../../test-utils/fake-redis-server";

describe("infrastructure/locking/redis-lock-service", () => {
  let server: FakeRedisServer;

  afterEach(async () => {
    await server?.close();
  });

  it("runs fn and returns its result when the lock is free", async () => {
    server = await startFakeRedisServer();
    const lock = new RedisLockService(new RedisClient({ url: server.url }));

    const result = await lock.withLock("job:1", 5000, async () => "done");
    expect(result).toBe("done");
  });

  it("releases the key after fn completes (server-side state confirms it)", async () => {
    server = await startFakeRedisServer();
    const lock = new RedisLockService(new RedisClient({ url: server.url }));

    await lock.withLock("job:1", 5000, async () => "done");
    expect(server.store.has("lock:job:1")).toBe(false);
  });

  it("returns null without calling fn when the key is already held by someone else", async () => {
    server = await startFakeRedisServer();
    // Simulate another instance already holding the lock.
    server.store.set("lock:job:1", { value: "someone-elses-token", expiresAt: Date.now() + 60_000 });

    const lock = new RedisLockService(new RedisClient({ url: server.url }));
    const fnSpy = vi.fn(async () => "should not run");

    const result = await lock.withLock("job:1", 5000, fnSpy);

    expect(result).toBeNull();
    expect(fnSpy).not.toHaveBeenCalled();
  });

  it("releases the lock even when fn throws", async () => {
    server = await startFakeRedisServer();
    const lock = new RedisLockService(new RedisClient({ url: server.url }));

    await expect(
      lock.withLock("job:1", 5000, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(server.store.has("lock:job:1")).toBe(false);
  });

  it("never deletes a lock key that was re-acquired by someone else after this holder's TTL expired", async () => {
    server = await startFakeRedisServer();
    const lock = new RedisLockService(new RedisClient({ url: server.url }));

    // Simulate: this call's lock already expired and was re-acquired by
    // a different holder with a different token by the time `fn` finishes.
    let capturedToken: string | undefined;
    await lock.withLock("job:1", 5000, async () => {
      capturedToken = server.store.get("lock:job:1")?.value;
      // Overwrite with a different token, as a fresh acquisition would.
      server.store.set("lock:job:1", { value: "a-different-holders-token", expiresAt: Date.now() + 60_000 });
    });

    expect(capturedToken).toBeDefined();
    // The release script must see the token mismatch and refuse to delete.
    expect(server.store.get("lock:job:1")?.value).toBe("a-different-holders-token");
  });

  it("rejects a non-positive ttlMs without contacting Redis", async () => {
    server = await startFakeRedisServer();
    const lock = new RedisLockService(new RedisClient({ url: server.url }));

    await expect(lock.withLock("job:1", 0, async () => "x")).rejects.toThrow(RangeError);
  });
});
