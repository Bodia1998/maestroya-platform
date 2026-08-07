import { afterEach, describe, expect, it, vi } from "vitest";

import { RedisRateLimitRepository } from "@/infrastructure/security/redis-rate-limit-repository";
import { RedisClient } from "@/infrastructure/cache/redis-client";
import { startFakeRedisServer } from "../../../../test-utils/fake-redis-server";
import type { FakeRedisServer } from "../../../../test-utils/fake-redis-server";

describe("infrastructure/security/redis-rate-limit-repository", () => {
  let server: FakeRedisServer;

  afterEach(async () => {
    await server?.close();
  });

  it("allows attempts up to the limit and blocks the one after", async () => {
    server = await startFakeRedisServer();
    const repo = new RedisRateLimitRepository(new RedisClient({ url: server.url }));
    const now = new Date();

    const first = await repo.consume("k", 3, 60_000, now);
    const second = await repo.consume("k", 3, 60_000, now);
    const third = await repo.consume("k", 3, 60_000, now);
    const fourth = await repo.consume("k", 3, 60_000, now);

    expect(first).toMatchObject({ allowed: true, remaining: 2 });
    expect(second).toMatchObject({ allowed: true, remaining: 1 });
    expect(third).toMatchObject({ allowed: true, remaining: 0 });
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterMs).not.toBeNull();
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it("keeps independent buckets per key", async () => {
    server = await startFakeRedisServer();
    const repo = new RedisRateLimitRepository(new RedisClient({ url: server.url }));
    const now = new Date();

    await repo.consume("user-a", 1, 60_000, now);
    const blockedA = await repo.consume("user-a", 1, 60_000, now);
    const allowedB = await repo.consume("user-b", 1, 60_000, now);

    expect(blockedA.allowed).toBe(false);
    expect(allowedB.allowed).toBe(true);
  });

  it("reset() clears a key's bucket, allowing a fresh window", async () => {
    server = await startFakeRedisServer();
    const repo = new RedisRateLimitRepository(new RedisClient({ url: server.url }));
    const now = new Date();

    await repo.consume("k", 1, 60_000, now);
    const blocked = await repo.consume("k", 1, 60_000, now);
    expect(blocked.allowed).toBe(false);

    await repo.reset("k");
    const afterReset = await repo.consume("k", 1, 60_000, now);
    expect(afterReset.allowed).toBe(true);
  });

  it("rejects a non-positive limit or windowMs without contacting Redis", async () => {
    server = await startFakeRedisServer();
    const repo = new RedisRateLimitRepository(new RedisClient({ url: server.url }));
    const now = new Date();

    await expect(repo.consume("k", 0, 60_000, now)).rejects.toThrow(RangeError);
    await expect(repo.consume("k", 5, 0, now)).rejects.toThrow(RangeError);
  });

  it("uses a single atomic EVAL call per consume() (not separate INCR/PEXPIRE round trips)", async () => {
    server = await startFakeRedisServer();
    const client = new RedisClient({ url: server.url });
    const commandSpy = vi.spyOn(client, "command");
    const repo = new RedisRateLimitRepository(client);

    await repo.consume("k", 5, 60_000, new Date());

    // AUTH/SELECT aren't sent (no password/db in this URL), so the only
    // application-level command is the one EVAL call.
    const appCommands = commandSpy.mock.calls.filter(([args]) => args[0] !== "AUTH" && args[0] !== "SELECT");
    expect(appCommands).toHaveLength(1);
    expect(appCommands[0]?.[0][0]).toBe("EVAL");
  });
});
