import "server-only";

import { getRedisClient } from "@/infrastructure/cache/redis-client-factory";
import type { RedisClient } from "@/infrastructure/cache/redis-client";

/**
 * Module 45 — Background Jobs (Roadmap Module 12).
 *
 * The *second* of this module's two idempotency mechanisms, and the one
 * that matters when a job is retried rather than merely enqueued twice:
 *
 *  1. **Enqueue-time de-duplication** — `JobOptions.jobId` + the
 *     `SET NX` in `RedisJobStore.add`. Stops the same logical job from
 *     ever entering the queue twice. Costs nothing and needs no store.
 *  2. **Execution-time de-duplication** — this file. A job that
 *     succeeded but whose completion was lost (worker killed between
 *     "handler ran" and "job marked complete") will be delivered again;
 *     an at-least-once queue cannot avoid that. Recording a key *after*
 *     a successful run, and skipping any job whose key is already
 *     recorded, converts at-least-once delivery into effectively-once
 *     *execution*.
 *
 * Marking happens **after** success, never before — a crash mid-handler
 * must leave the job retryable. The cost of that ordering is the narrow
 * window described above (mark succeeded, completion lost → one
 * duplicate skip is impossible, one duplicate run is); the cost of the
 * reverse ordering would be silently dropping work, which is strictly
 * worse.
 *
 * ## Why this is not a duplicate of an existing mechanism
 * The audit for this module found exactly one other idempotency
 * mechanism in the codebase: the financial ledger's business-level
 * idempotency keys (`record-commission-for-payment.use-case.ts`,
 * `create-financial-adjustment.use-case.ts`), which are *persisted
 * domain data* backed by a database unique constraint and are part of
 * the financial audit trail. That is a different thing at a different
 * layer, with different durability requirements, and is deliberately
 * left untouched. This store is ephemeral, infrastructure-only, TTL'd,
 * and never a source of truth for anything a user can see.
 *
 * Falls back to a process-local `Map` when `REDIS_URL` is unset, exactly
 * like every other Redis-backed service in this codebase (Module 44).
 * In that mode the queue is process-local too, so a process-local
 * de-duplication window is precisely the right scope.
 */
export interface JobIdempotencyStore {
  /** True when `key` has already been recorded as successfully processed. */
  isProcessed(key: string): Promise<boolean>;
  /** Records `key` as processed, expiring after `ttlMs`. */
  markProcessed(key: string, ttlMs: number): Promise<void>;
}

/** 24h — long enough to cover any realistic retry/redeploy window, short enough to bound memory. */
export const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export class RedisJobIdempotencyStore implements JobIdempotencyStore {
  constructor(private readonly client: RedisClient) {}

  async isProcessed(key: string): Promise<boolean> {
    return (await this.client.command(["EXISTS", this.storeKey(key)])) === 1;
  }

  async markProcessed(key: string, ttlMs: number): Promise<void> {
    await this.client.command(["SET", this.storeKey(key), "1", "PX", Math.max(1, Math.round(ttlMs))]);
  }

  private storeKey(key: string): string {
    return `jobs:idempotency:${key}`;
  }
}

export class InMemoryJobIdempotencyStore implements JobIdempotencyStore {
  private readonly entries = new Map<string, number>();

  async isProcessed(key: string): Promise<boolean> {
    const expiresAt = this.entries.get(key);
    if (expiresAt === undefined) return false;
    if (expiresAt <= Date.now()) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  async markProcessed(key: string, ttlMs: number): Promise<void> {
    this.entries.set(key, Date.now() + ttlMs);
    this.evictExpired();
  }

  /**
   * Lazy sweep on write — the same approach `InMemoryCacheService` takes
   * (Module 44), and for the same reason: a background `setInterval`
   * would keep the Node process alive and is unnecessary for a map whose
   * only growth path is a write.
   */
  private evictExpired(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(key);
    }
  }
}

let instance: JobIdempotencyStore | null = null;

export function createJobIdempotencyStore(): JobIdempotencyStore {
  if (!instance) {
    const redisClient = getRedisClient();
    instance = redisClient ? new RedisJobIdempotencyStore(redisClient) : new InMemoryJobIdempotencyStore();
  }
  return instance;
}

/** Exposed for tests only — forces the next call to re-decide. */
export const __testing = {
  reset(): void {
    instance = null;
  },
};
