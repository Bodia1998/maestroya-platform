import "server-only";

import type { RedisClient } from "@/infrastructure/cache/redis-client";
import type { JobStore } from "@/infrastructure/jobs/job-store";
import type { QueueCounts, StoredJob } from "@/infrastructure/jobs/job-types";

/**
 * Module 45 — Background Jobs (Roadmap Module 12).
 *
 * Durable, cross-instance `JobStore` built on the **existing** Module 44
 * `RedisClient` (`infrastructure/cache/redis-client.ts`). This module
 * deliberately does not construct a Redis connection of its own and does
 * not add a second client library: the connection is injected, and
 * `job-store-factory.ts` gets it from the one shared
 * `getRedisClient()` singleton every other Redis-backed service already
 * uses. One connection, one factory, one lifecycle — the same one
 * `instrumentation.ts` already closes on SIGTERM.
 *
 * ## Key layout
 * ```
 * jobs:<queue>:pending          ZSET  member = jobId, score = processAt (epoch ms)
 * jobs:<queue>:active           ZSET  member = jobId, score = reservedAt (epoch ms)
 * jobs:<queue>:job:<jobId>      STRING JSON-encoded StoredJob
 * jobs:<queue>:completed        STRING integer counter
 * jobs:<queue>:failed           STRING integer counter
 * ```
 * A single ZSET serves both the `waiting` and `delayed` states — the
 * distinction is purely "is `score <= now`", which is also exactly the
 * query `reserve()` needs, so no job ever has to be *moved* between two
 * structures as its delay elapses (the promotion step BullMQ needs a
 * separate delayed-set sweep for).
 *
 * ## Atomic reservation without Lua
 * `ZRANGEBYSCORE … LIMIT 0 1` then `ZREM` on the returned member: `ZREM`
 * returns 1 for exactly one caller and 0 for every other racing worker,
 * so the winner is unambiguous and no two workers can claim the same job.
 * Losers simply return `null` and poll again. This is the same
 * compare-and-act discipline `RedisLockService` uses, and it avoids
 * adding a second Lua script to maintain (`redis-rate-limit-repository.ts`
 * has the only one today).
 *
 * ## Failure posture
 * Every method lets a Redis error reject. Unlike the cache — where a
 * miss is harmless — silently swallowing "could not enqueue this job"
 * would drop work on the floor. `Queue.add`'s caller decides what that
 * means; for the event bus it surfaces as an `EventDispatchError`, the
 * exact shape publishers already catch and report (see
 * `queued-event-bus.ts`).
 */
export class RedisJobStore implements JobStore {
  constructor(private readonly client: RedisClient) {}

  async add(job: StoredJob): Promise<StoredJob | null> {
    // SET NX is the de-duplication point: the first writer of a given
    // job id wins and is the only one that goes on to index it in
    // `pending`. A duplicate never touches the ZSET at all, so it can
    // never be reserved twice.
    const stored = await this.client.command(["SET", this.jobKey(job.queue, job.id), JSON.stringify(job), "NX"]);
    if (stored === null) return null;

    await this.client.command(["ZADD", this.pendingKey(job.queue), job.processAt, job.id]);
    return job;
  }

  async reserve(queue: string, now: number): Promise<StoredJob | null> {
    const due = await this.client.command([
      "ZRANGEBYSCORE",
      this.pendingKey(queue),
      "-inf",
      now,
      "LIMIT",
      0,
      1,
    ]);

    const jobId = Array.isArray(due) ? due[0] : null;
    if (typeof jobId !== "string") return null;

    const claimed = await this.client.command(["ZREM", this.pendingKey(queue), jobId]);
    if (claimed !== 1) return null; // another worker won the race

    const raw = await this.client.command(["GET", this.jobKey(queue, jobId)]);
    if (typeof raw !== "string") return null; // payload expired or was drained concurrently

    const job = JSON.parse(raw) as StoredJob;
    const reserved: StoredJob = { ...job, attemptsMade: job.attemptsMade + 1 };

    await this.client.command(["SET", this.jobKey(queue, jobId), JSON.stringify(reserved)]);
    await this.client.command(["ZADD", this.activeKey(queue), now, jobId]);

    return reserved;
  }

  async complete(job: StoredJob): Promise<void> {
    await this.client.command(["ZREM", this.activeKey(job.queue), job.id]);
    await this.client.command(["DEL", this.jobKey(job.queue, job.id)]);
    await this.client.command(["INCR", this.counterKey(job.queue, "completed")]);
  }

  async retry(job: StoredJob, processAt: number, failedReason: string): Promise<void> {
    const next: StoredJob = { ...job, processAt, failedReason };
    await this.client.command(["ZREM", this.activeKey(job.queue), job.id]);
    await this.client.command(["SET", this.jobKey(job.queue, job.id), JSON.stringify(next)]);
    await this.client.command(["ZADD", this.pendingKey(job.queue), processAt, job.id]);
  }

  async fail(job: StoredJob, failedReason: string): Promise<void> {
    void failedReason;
    await this.client.command(["ZREM", this.activeKey(job.queue), job.id]);
    await this.client.command(["DEL", this.jobKey(job.queue, job.id)]);
    await this.client.command(["INCR", this.counterKey(job.queue, "failed")]);
  }

  async counts(queue: string, now: number): Promise<QueueCounts> {
    const [waiting, delayed, active, completed, failed] = await Promise.all([
      this.client.command(["ZCOUNT", this.pendingKey(queue), "-inf", now]),
      this.client.command(["ZCOUNT", this.pendingKey(queue), `(${now}`, "+inf"]),
      this.client.command(["ZCARD", this.activeKey(queue)]),
      this.client.command(["GET", this.counterKey(queue, "completed")]),
      this.client.command(["GET", this.counterKey(queue, "failed")]),
    ]);

    return {
      waiting: toCount(waiting),
      delayed: toCount(delayed),
      active: toCount(active),
      completed: toCount(completed),
      failed: toCount(failed),
      // Dead-lettered jobs live in their own queue and are counted there
      // (as that queue's `waiting`) — see `Queue.getCounts`'s caller in
      // `queue-health.ts`.
      deadLettered: 0,
    };
  }

  async drain(queue: string): Promise<void> {
    const ids = await this.client.command(["ZRANGE", this.pendingKey(queue), 0, -1]);
    if (Array.isArray(ids)) {
      for (const id of ids) {
        if (typeof id === "string") await this.client.command(["DEL", this.jobKey(queue, id)]);
      }
    }
    await this.client.command(["DEL", this.pendingKey(queue)]);
  }

  /**
   * Intentionally a no-op: this store does not own the connection it was
   * handed. `getRedisClient()`'s single shared client is closed exactly
   * once, by `instrumentation.ts`'s existing shutdown hook — closing it
   * from here would tear the connection out from under the cache, rate
   * limiter, and lock service too.
   */
  async close(): Promise<void> {}

  private pendingKey(queue: string): string {
    return `jobs:${queue}:pending`;
  }

  private activeKey(queue: string): string {
    return `jobs:${queue}:active`;
  }

  private jobKey(queue: string, jobId: string): string {
    return `jobs:${queue}:job:${jobId}`;
  }

  private counterKey(queue: string, counter: "completed" | "failed"): string {
    return `jobs:${queue}:${counter}`;
  }
}

function toCount(reply: unknown): number {
  if (typeof reply === "number") return reply;
  if (typeof reply === "string") {
    const parsed = Number.parseInt(reply, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
