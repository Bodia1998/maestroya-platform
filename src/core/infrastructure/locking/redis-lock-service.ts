import "server-only";

import * as crypto from "node:crypto";

import type { DistributedLock } from "@/application/ports/distributed-lock";
import type { RedisClient } from "@/infrastructure/cache/redis-client";

/**
 * Module 44 — Redis Infrastructure (Roadmap Module 11).
 *
 * Redis-backed `DistributedLock` — safe across multiple app instances,
 * which is the entire point of a *distributed* lock (a single-process
 * `Map`-based mutex, as tempting as it'd be to keep this dependency-free
 * like `InMemoryLockService`, cannot coordinate across instances by
 * definition — see `InMemoryLockService`'s own doc comment for why it
 * exists only as the deliberately-scoped local fallback).
 *
 * **Acquisition:** `SET key token PX ttlMs NX` — a single atomic command
 * ("set this key to `token`, expiring in `ttlMs` ms, only if it doesn't
 * already exist"). `NX` is what makes acquisition itself race-free: two
 * instances racing to acquire the same key can never both succeed, since
 * Redis processes commands from all clients one at a time.
 *
 * **Release:** a random per-acquisition `token` (via `crypto.randomUUID`)
 * is stored as the key's value and checked before deleting — release
 * only ever deletes the key if its value still matches the token *this*
 * `withLock` call acquired. Without this check, a lock instance whose
 * `fn` ran longer than `ttlMs` (the key already expired and was
 * re-acquired by a different holder) would delete the *new* holder's
 * lock on "release", defeating the TTL safety net entirely. The
 * check-then-delete is itself done via a Lua script (`EVAL`) for the
 * same atomicity reason `RedisRateLimitRepository` uses one — a plain
 * `GET` + `DEL` from this client would race against another client's
 * write between the two commands.
 */
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

export class RedisLockService implements DistributedLock {
  constructor(private readonly client: RedisClient) {}

  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
    if (ttlMs <= 0) {
      throw new RangeError("DistributedLock.withLock: ttlMs must be a positive integer.");
    }

    const token = crypto.randomUUID();
    const lockKey = `lock:${key}`;

    const acquired = await this.client.command(["SET", lockKey, token, "PX", ttlMs, "NX"]);
    if (acquired !== "OK") return null;

    try {
      return await fn();
    } finally {
      await this.client.command(["EVAL", RELEASE_SCRIPT, "1", lockKey, token]);
    }
  }
}
