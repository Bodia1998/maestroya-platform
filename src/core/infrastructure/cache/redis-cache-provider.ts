import "server-only";

import type { CacheProvider } from "@/application/ports/cache-provider";
import type { RedisClient, RedisClientReply } from "@/infrastructure/cache/redis-client";

/**
 * Module 46 — Caching Layer (Roadmap Module 13).
 *
 * `CacheProvider` backed by the same shared `RedisClient` singleton
 * Module 44's `RedisCacheService` uses (see `redis-client-factory.ts`) —
 * this module does not open a second connection to Redis, exactly as the
 * task requires. `get`/`set`/`delete`/`has` are identical in behavior to
 * `RedisCacheService`'s own (JSON-serialized values, atomic `SET ... PX`,
 * a malformed stored value treated as a miss rather than thrown) — see
 * that class's doc comment for the full reasoning, which applies here
 * unchanged.
 *
 * `deletePattern` is the one new capability `CacheProvider` adds over
 * `CacheService`: a `SCAN`-cursor loop (never `KEYS`, which blocks the
 * single-threaded Redis server for the duration of a full keyspace scan
 * — `SCAN` trades one round trip for many small, non-blocking ones,
 * the standard production-safe way to enumerate keys) followed by `DEL`
 * on whatever batch of matches each cursor step returns.
 */
const SCAN_COUNT_HINT = 200;

export class RedisCacheProvider implements CacheProvider {
  constructor(private readonly client: RedisClient) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.command(["GET", key]);
    if (raw === null || typeof raw !== "string") return null;

    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    if (ttlMs <= 0) {
      throw new RangeError("CacheProvider.set: ttlMs must be a positive integer.");
    }
    const serialized = JSON.stringify(value);
    await this.client.command(["SET", key, serialized, "PX", ttlMs]);
  }

  async delete(key: string): Promise<void> {
    await this.client.command(["DEL", key]);
  }

  async has(key: string): Promise<boolean> {
    const result = await this.client.command(["EXISTS", key]);
    return result === 1;
  }

  async deletePattern(pattern: string): Promise<number> {
    let removed = 0;
    let cursor = "0";

    do {
      const reply = await this.client.command(["SCAN", cursor, "MATCH", pattern, "COUNT", SCAN_COUNT_HINT]);
      const [nextCursor, matches] = parseScanReply(reply);
      cursor = nextCursor;

      if (matches.length > 0) {
        await this.client.command(["DEL", ...matches]);
        removed += matches.length;
      }
    } while (cursor !== "0");

    return removed;
  }
}

/** `SCAN`'s reply is always a 2-element array: `[nextCursor, matchedKeys[]]`. */
function parseScanReply(reply: RedisClientReply): [string, string[]] {
  if (!Array.isArray(reply) || reply.length !== 2) {
    throw new Error(`Unexpected SCAN reply shape: ${JSON.stringify(reply)}`);
  }
  const [cursor, matches] = reply;
  if (typeof cursor !== "string" || !Array.isArray(matches)) {
    throw new Error(`Unexpected SCAN reply shape: ${JSON.stringify(reply)}`);
  }
  return [cursor, matches.filter((item): item is string => typeof item === "string")];
}
