/**
 * Module 45 — Background Jobs (Roadmap Module 12).
 *
 * The vocabulary of the queue layer, modelled deliberately on BullMQ's
 * public job API (`attempts`, `backoff: { type, delay }`, `delay`,
 * `jobId`, `repeat`, and the `waiting`/`delayed`/`active`/`completed`/
 * `failed` state names) so that the semantics documented here are the
 * ones a reader already knows, and so that swapping the storage engine
 * underneath (see `job-store.ts`) is the only change needed to run on
 * real BullMQ once an npm registry is reachable — see
 * docs/MODULE_45_BACKGROUND_JOBS.md, "Architecture decisions".
 *
 * Nothing in this file knows about domain events; the event-bus
 * integration lives in `infrastructure/events/` and uses this layer as a
 * generic transport (see `queued-event-bus.ts`).
 */

/** Backoff strategies, matching BullMQ's `BackoffOptions.type`. */
export type BackoffType = "fixed" | "exponential";

export interface BackoffOptions {
  type: BackoffType;
  /**
   * Base delay in milliseconds. `fixed` waits exactly this long between
   * every attempt; `exponential` waits `delay * 2 ** (attemptsMade - 1)`.
   */
  delay: number;
  /**
   * Fraction (0–1) of the computed delay to randomise away, to stop a
   * batch of jobs that all failed on the same downstream outage from
   * retrying in lockstep. Not a BullMQ built-in (BullMQ expects a custom
   * backoff strategy for this); defaulted off so behaviour without it is
   * exactly BullMQ's.
   */
  jitter?: number;
}

/** Repeat options, matching the subset of BullMQ's `RepeatOptions` used here. */
export interface RepeatOptions {
  /** Fixed interval in milliseconds between runs. Mutually exclusive with `pattern`. */
  every?: number;
  /** Standard 5-field cron expression (see `cron-expression.ts`). Mutually exclusive with `every`. */
  pattern?: string;
  /** Stop after this many runs. Unlimited when omitted. */
  limit?: number;
}

export interface JobOptions {
  /**
   * Explicit job id. Two `add()` calls with the same queue and the same
   * `jobId` produce exactly one job — BullMQ's own de-duplication
   * semantics, and this layer's first line of idempotency defence (see
   * `job-idempotency-store.ts` for the second, post-execution one).
   */
  jobId?: string;
  /** Total attempts before the job is considered exhausted. Default 1 (no retry). */
  attempts?: number;
  backoff?: BackoffOptions;
  /** Milliseconds to hold the job in the `delayed` state before it becomes runnable. */
  delay?: number;
  repeat?: RepeatOptions;
}

/** `JobOptions` after defaults have been applied — what a `StoredJob` actually carries. */
export interface NormalizedJobOptions {
  attempts: number;
  backoff: BackoffOptions;
}

export const DEFAULT_BACKOFF: BackoffOptions = { type: "exponential", delay: 1000 };

export function normalizeJobOptions(options: JobOptions | undefined): NormalizedJobOptions {
  const attempts = options?.attempts ?? 1;
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError(`Job "attempts" must be an integer >= 1, received ${String(attempts)}`);
  }

  const delay = options?.delay ?? 0;
  if (!Number.isFinite(delay) || delay < 0) {
    throw new RangeError(`Job "delay" must be a non-negative number of milliseconds, received ${String(delay)}`);
  }

  return { attempts, backoff: options?.backoff ?? DEFAULT_BACKOFF };
}

/**
 * A job as persisted by a `JobStore`. Deliberately a plain, JSON-safe
 * record rather than a class: it round-trips through `JSON.stringify` on
 * its way into Redis and back, so it must not carry behaviour, `Date`
 * instances, or prototypes that would not survive the trip. Timestamps
 * are epoch milliseconds for the same reason (and because the Redis
 * store sorts on them directly, as ZSET scores).
 */
export interface StoredJob<TData = unknown> {
  id: string;
  queue: string;
  /** Logical job type within the queue, e.g. an event name. BullMQ's `job.name`. */
  name: string;
  data: TData;
  opts: NormalizedJobOptions;
  /** How many attempts have already been *started* (0 until the first reserve). */
  attemptsMade: number;
  createdAt: number;
  /** Epoch ms before which the job must not be reserved — implements both `delay` and backoff. */
  processAt: number;
  /** Set once the job has failed at least once; the most recent failure's message. */
  failedReason?: string;
  /**
   * Module 51 — Distributed Tracing: W3C trace context (`traceparent`/
   * `tracestate`) captured by `Queue.add` from whatever was active at
   * enqueue time, so the worker's span can be parented to the request
   * that scheduled the work rather than starting an unrelated trace.
   *
   * Optional and absent by default — nothing is written here unless
   * `TRACING_ENABLED=true`, so a stored job is byte-identical to what it
   * was before that module existed. A flat string map by construction
   * (see `TraceCarrier`), which is what keeps this field JSON-safe and
   * therefore compatible with `RedisJobStore`'s `JSON.stringify` round
   * trip, per this interface's own "no behaviour, no Date instances"
   * rule above.
   */
  trace?: Record<string, string>;
}

/** The handle a worker's processor function receives. */
export interface ActiveJob<TData = unknown> {
  readonly id: string;
  readonly queue: string;
  readonly name: string;
  readonly data: TData;
  /** 1-based attempt number currently executing. */
  readonly attempt: number;
  readonly maxAttempts: number;
  /** Module 51 — the enqueue-time trace context, carried through from
   *  `StoredJob.trace` so `TracingJobLifecycleObserver` can parent the
   *  processing span to it. `undefined` whenever tracing is disabled. */
  readonly trace?: Record<string, string>;
}

export function toActiveJob<TData>(job: StoredJob<TData>): ActiveJob<TData> {
  return {
    id: job.id,
    queue: job.queue,
    name: job.name,
    data: job.data,
    attempt: job.attemptsMade,
    maxAttempts: job.opts.attempts,
    // Spread-free conditional: an untraced job must not gain a
    // `trace: undefined` key that would show up in a `toEqual` assertion
    // or a JSON payload it never had before.
    ...(job.trace ? { trace: job.trace } : {}),
  };
}

/** Counts per queue, mirroring BullMQ's `getJobCounts()` keys. */
export interface QueueCounts {
  waiting: number;
  delayed: number;
  active: number;
  completed: number;
  failed: number;
  deadLettered: number;
}

export const EMPTY_QUEUE_COUNTS: QueueCounts = {
  waiting: 0,
  delayed: 0,
  active: 0,
  completed: 0,
  failed: 0,
  deadLettered: 0,
};
