import "server-only";

import type {
  RateLimitDecision,
  RateLimitRepository,
} from "@/domain/repositories/rate-limit-repository";
import type { RedisClient } from "@/infrastructure/cache/redis-client";

/**
 * Module 44 — Redis Infrastructure (Roadmap Module 11).
 *
 * The Redis-backed `RateLimitRepository` implementation
 * `InMemoryRateLimitRepository`'s own doc comment (Module 24) explicitly
 * anticipated: "a Redis Lua script or INCR closes this gap when Module 25
 * swaps the backend" — Module 25 deliberately deferred actually building
 * it (no Redis dependency existed yet); this module is that swap.
 *
 * Wired up automatically once `REDIS_URL` is configured (see
 * `rate-limit-repository-factory.ts`) — zero changes to
 * `AntiAbuseService`, `application/use-cases/security/compose.ts`'s
 * callers, or any Server Action that consumes rate limiting; the whole
 * point of the `RateLimitRepository` interface (Module 24) was to make
 * this swap a pure infrastructure change.
 *
 * **Atomicity via `EVAL`:** a plain `INCR` followed by a separate
 * `PEXPIRE` call (the naive approach) has the same read-then-write race
 * `InMemoryRateLimitRepository`'s own doc comment flags for its `Map` —
 * two commands are not atomic across each other even against a single
 * Redis instance, and a process crash between them would leave a key
 * that increments forever without ever expiring. A single Lua script
 * (`EVAL`) is what Redis guarantees runs atomically — no other command
 * from any client can interleave with it — so this repository sends one
 * `EVAL` call per `consume()`, not two round-trips.
 *
 * **Window semantics match `InMemoryRateLimitRepository` exactly** (same
 * fixed-window algorithm as `domain/services/rate-limit-window.ts`, just
 * expressed in Lua instead of TypeScript): the window starts at the
 * first `consume()` call for a fresh key and lasts `windowMs` from there
 * (not aligned to a fixed clock boundary) — `PEXPIRE` is set only on the
 * increment that creates the key (`count == 1`), so subsequent calls
 * within the same window don't reset the TTL. This is intentionally the
 * *same* trade-off already documented and accepted for the in-memory
 * implementation (a short burst is possible right at a window boundary),
 * not a new one introduced here — callers get identical behavior
 * regardless of which backend is active, which is the whole point of the
 * shared interface.
 */
const CONSUME_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])

local count = redis.call("INCR", key)
if count == 1 then
  redis.call("PEXPIRE", key, windowMs)
end

local ttl = redis.call("PTTL", key)
-- PTTL can return -1 (no expiry set — shouldn't happen given the above,
-- but defensively treated as "expires now") if this key somehow survived
-- from a version of this script that didn't set one.
if ttl < 0 then
  ttl = 0
end

if count > limit then
  return {0, limit, 0, ttl}
else
  local remaining = limit - count
  if remaining < 0 then
    remaining = 0
  end
  return {1, remaining, ttl}
end
`;

export class RedisRateLimitRepository implements RateLimitRepository {
  constructor(private readonly client: RedisClient) {}

  async consume(
    key: string,
    limit: number,
    windowMs: number,
    _now: Date,
  ): Promise<RateLimitDecision> {
    if (limit <= 0) {
      throw new RangeError("Rate limit policy `limit` must be a positive integer.");
    }
    if (windowMs <= 0) {
      throw new RangeError("Rate limit policy `windowMs` must be a positive integer.");
    }

    const reply = await this.client.command(["EVAL", CONSUME_SCRIPT, "1", key, limit, windowMs]);

    if (!Array.isArray(reply)) {
      throw new Error(`Unexpected reply shape from Redis rate-limit script: ${JSON.stringify(reply)}`);
    }

    const values = reply as number[];
    const allowedFlag = values[0];

    if (allowedFlag === 0) {
      // [0, limit, 0, ttl]
      const replyLimit = values[1] ?? limit;
      const ttl = values[3] ?? 0;
      return { allowed: false, limit: replyLimit, remaining: 0, retryAfterMs: ttl };
    }
    // [1, remaining, ttl]
    const remaining = values[1] ?? 0;
    return { allowed: true, limit, remaining, retryAfterMs: null };
  }

  async reset(key: string): Promise<void> {
    await this.client.command(["DEL", key]);
  }
}
