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

  it("fails closed (rejects, never runs fn) when Redis is unreachable during acquisition — a lock outage must never be treated as 'lock acquired'", async () => {
    // Module 87 — start a real fake server so we get a genuine free port,
    // then close it immediately: the port is real but nothing is
    // listening, giving a real ECONNREFUSED rather than a DNS/hostname
    // failure. `RedisLockService` must propagate this as a rejection
    // (fail-closed) rather than ever returning as if the lock were free
    // or held — a caller wrapping a financial operation in `withLock`
    // must never proceed unprotected just because Redis happened to be
    // down.
    const doomedServer = await startFakeRedisServer();
    const unreachablePort = doomedServer.port;
    await doomedServer.close();

    const lock = new RedisLockService(new RedisClient({ url: `redis://127.0.0.1:${unreachablePort}`, connectTimeoutMs: 500 }));
    const fnSpy = vi.fn(async () => "should never run");

    await expect(lock.withLock("job:1", 5000, fnSpy)).rejects.toBeTruthy();
    expect(fnSpy).not.toHaveBeenCalled();
  });

  it("surfaces a release-time Redis failure as a rejection even when fn itself already succeeded — the caller must not silently believe release cleanly happened", async () => {
    // Module 87 — Redis becomes unreachable *after* fn has already run
    // and returned successfully, but before the release EVAL completes.
    // This documents `RedisLockService`'s actual current behavior: the
    // `finally` block's failed release rejects the whole `withLock` call,
    // discarding fn's successful result. Financial use cases built on
    // this port are themselves idempotent (a retry converges rather than
    // double-executing — see e.g. `execute-refund.use-case.test.ts`'s own
    // concurrency test), which is what makes this fail-loud-on-release
    // behavior safe rather than silently masking a stuck lock.
    let fnRan = false;
    server = await startFakeRedisServer();
    const lock = new RedisLockService(new RedisClient({ url: server.url }));

    await expect(
      lock.withLock("job:1", 5000, async () => {
        fnRan = true;
        await server.close();
        return "fn succeeded";
      }),
    ).rejects.toBeTruthy();

    expect(fnRan).toBe(true);
  });

  it("rejects a non-positive ttlMs without contacting Redis", async () => {
    server = await startFakeRedisServer();
    const lock = new RedisLockService(new RedisClient({ url: server.url }));

    await expect(lock.withLock("job:1", 0, async () => "x")).rejects.toThrow(RangeError);
  });
});
