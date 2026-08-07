import type { QueueCounts, StoredJob } from "@/infrastructure/jobs/job-types";

/**
 * Module 45 — Background Jobs (Roadmap Module 12).
 *
 * The one seam between the queue/worker semantics (which are BullMQ's,
 * and live in `queue.ts`/`worker.ts`) and where jobs actually live.
 * `Queue` and `Worker` contain no storage knowledge whatsoever; a store
 * contains no retry, backoff, dead-letter, or scheduling policy. That
 * split is what makes `RedisJobStore` (multi-instance, durable) and
 * `InMemoryJobStore` (single instance, dev/test) interchangeable — and
 * what would make a `BullMQJobStore` a drop-in third implementation once
 * an npm registry is reachable and the real `bullmq` package can be
 * installed (see docs/MODULE_45_BACKGROUND_JOBS.md).
 *
 * ## Concurrency contract
 * `reserve()` must be atomic across processes: two workers polling the
 * same queue at the same instant must never both receive the same job.
 * `RedisJobStore` gets this from `ZREM` returning 1 to exactly one
 * caller; `InMemoryJobStore` gets it trivially from the single-threaded
 * event loop. Everything else in this layer is built on that one
 * guarantee.
 */
export interface JobStore {
  /**
   * Persists `job` in the `waiting`/`delayed` set. Returns `null` — and
   * stores nothing — when a job with the same id already exists in this
   * queue, which is how `JobOptions.jobId` de-duplication is delivered
   * (see `job-types.ts`).
   */
  add(job: StoredJob): Promise<StoredJob | null>;

  /**
   * Atomically claims the next job whose `processAt <= now`, moving it
   * from `waiting` to `active` and incrementing `attemptsMade`. Returns
   * `null` when nothing is due.
   */
  reserve(queue: string, now: number): Promise<StoredJob | null>;

  /** Removes an active job and records it as completed. */
  complete(job: StoredJob): Promise<void>;

  /**
   * Returns an active job to the `delayed` set for another attempt at
   * `processAt`, recording `failedReason`.
   */
  retry(job: StoredJob, processAt: number, failedReason: string): Promise<void>;

  /**
   * Removes an active job that has exhausted its attempts and records it
   * as failed. Moving the payload onto a dead-letter queue is the
   * `Worker`'s job (it re-`add()`s to a different queue), not the store's.
   */
  fail(job: StoredJob, failedReason: string): Promise<void>;

  /**
   * Splits `queue`'s jobs into waiting (due, `processAt <= now`) vs
   * delayed (`processAt > now`), plus active/completed/failed. Takes
   * `now` explicitly — same as `reserve()` — rather than reading the
   * wall clock itself, so a caller using an injected/virtual clock (e.g.
   * `Queue`'s own `now` dependency) gets a waiting/delayed split
   * consistent with the clock that produced `processAt` in the first
   * place. `Queue.getCounts()` is the only caller and always passes its
   * own `now()`.
   */
  counts(queue: string, now: number): Promise<QueueCounts>;

  /** Removes every waiting/delayed job from `queue`. Does not touch active jobs. */
  drain(queue: string): Promise<void>;

  /** Releases any resources the store owns. Must be safe to call twice. */
  close(): Promise<void>;
}
