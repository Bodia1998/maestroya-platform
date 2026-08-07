import { computeBackoffDelayMs } from "@/infrastructure/jobs/backoff";
import type { JobIdempotencyStore } from "@/infrastructure/jobs/job-idempotency-store";
import { DEFAULT_IDEMPOTENCY_TTL_MS } from "@/infrastructure/jobs/job-idempotency-store";
import type { JobLifecycleObserver } from "@/infrastructure/jobs/job-observability";
import { nullJobLifecycleObserver } from "@/infrastructure/jobs/job-observability";
import type { JobStore } from "@/infrastructure/jobs/job-store";
import type { ActiveJob, StoredJob } from "@/infrastructure/jobs/job-types";
import { toActiveJob } from "@/infrastructure/jobs/job-types";
import type { Queue } from "@/infrastructure/jobs/queue";

/** What a worker runs for each job. Throwing means "this attempt failed". */
export type JobProcessor<TData> = (job: ActiveJob<TData>) => Promise<void> | void;

/** The payload a dead-lettered job carries — enough to diagnose and replay it. */
export interface DeadLetterJobData {
  originalQueue: string;
  originalJobId: string;
  jobName: string;
  data: unknown;
  attemptsMade: number;
  failedReason: string;
  failedAt: string;
}

export interface WorkerIdempotencyOptions {
  store: JobIdempotencyStore;
  /**
   * Derives the de-duplication key for a job, or `null` to opt this job
   * out of execution-time de-duplication entirely.
   */
  keyFor: (job: ActiveJob<never>) => string | null;
  ttlMs?: number;
}

export interface WorkerOptions {
  store: JobStore;
  /** How many jobs this worker runs at once. BullMQ's `concurrency`. Default 1. */
  concurrency?: number;
  /** How long to wait before re-polling an empty queue. Default 1000ms. */
  pollIntervalMs?: number;
  /** Where exhausted jobs are parked. Omit to drop them after reporting. */
  deadLetterQueue?: Queue<DeadLetterJobData>;
  idempotency?: WorkerIdempotencyOptions;
  observer?: JobLifecycleObserver;
  now?: () => number;
  /** Start polling immediately on construction. Default `false` — see the class doc. */
  autorun?: boolean;
}

/**
 * Module 45 — Background Jobs (Roadmap Module 12).
 *
 * The consumer half of the queue, with BullMQ's `Worker` semantics:
 * bounded `concurrency`, `attempts` with exponential `backoff`, and a
 * `close()` that drains in-flight work rather than abandoning it.
 * Everything it knows about storage comes through `JobStore` (see
 * `job-store.ts`).
 *
 * ## Polling, not blocking
 * BullMQ's worker blocks on `BRPOPLPUSH`; this one polls on an interval.
 * The reason is Module 44's `RedisClient`, which is a single-connection,
 * ordered request/response pipeline with a per-command timeout — a
 * blocking read would occupy that shared connection and stall the cache,
 * rate limiter, and lock service behind it. Polling costs one cheap
 * `ZRANGEBYSCORE` per interval per worker and keeps the shared
 * connection responsive, which is the right trade at this platform's job
 * volume. `pollIntervalMs` bounds the added latency.
 *
 * ## `autorun` defaults to false
 * A worker that starts a timer in its constructor is untestable
 * (every test races the loop) and hostile to Next.js's build step, where
 * modules are imported for analysis and must not start doing work.
 * Starting is therefore an explicit `start()` call, made once from
 * `jobs/compose.ts`'s `startBackgroundJobs()` — which
 * `instrumentation.ts` calls at boot, after subscriber registration.
 * Tests drive the worker deterministically via `processNext()` instead.
 *
 * ## Failure handling
 * A throwing processor never escapes this class. The job is either
 * retried with backoff (attempts remaining) or reported and moved to the
 * dead-letter queue (attempts exhausted). The polling loop itself is
 * likewise total: a `JobStore` error during `reserve()` is reported and
 * the loop backs off rather than dying, because a worker that silently
 * stops polling after one Redis blip is the worst possible failure mode
 * for a background job system.
 */
export class Worker<TData = unknown> {
  private readonly store: JobStore;
  private readonly concurrency: number;
  private readonly pollIntervalMs: number;
  private readonly deadLetterQueue?: Queue<DeadLetterJobData>;
  private readonly idempotency?: WorkerIdempotencyOptions;
  private readonly observer: JobLifecycleObserver;
  private readonly now: () => number;

  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    readonly queueName: string,
    private readonly processor: JobProcessor<TData>,
    options: WorkerOptions,
  ) {
    this.store = options.store;
    this.concurrency = Math.max(1, options.concurrency ?? 1);
    this.pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 1000);
    this.deadLetterQueue = options.deadLetterQueue;
    this.idempotency = options.idempotency;
    this.observer = options.observer ?? nullJobLifecycleObserver;
    this.now = options.now ?? Date.now;

    if (options.autorun) this.start();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleTick(0);
  }

  /**
   * Reserves and fully processes at most one job, awaiting it to
   * completion. Returns `false` when nothing was due. This is the unit
   * the polling loop is built from, and the hook tests use to advance
   * the worker one job at a time with no timers involved.
   */
  async processNext(): Promise<boolean> {
    const job = (await this.store.reserve(this.queueName, this.now())) as StoredJob<TData> | null;
    if (!job) return false;
    await this.process(job);
    return true;
  }

  /**
   * Stops polling and waits for every in-flight job to finish. Safe to
   * call when never started, and safe to call twice — both are normal
   * during a shutdown that races an already-failing process.
   */
  async close(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await Promise.allSettled([...this.inFlight]);
  }

  get isRunning(): boolean {
    return this.running;
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  private scheduleTick(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, delayMs);
    // Never hold the process open purely to poll an empty queue — the
    // same reasoning `InMemoryLockService` applies to its expiry timers.
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    let reservedAny = false;

    try {
      while (this.running && this.inFlight.size < this.concurrency) {
        const job = (await this.store.reserve(this.queueName, this.now())) as StoredJob<TData> | null;
        if (!job) break;

        reservedAny = true;
        const promise = this.process(job).finally(() => {
          this.inFlight.delete(promise);
        });
        this.inFlight.add(promise);
      }
    } catch (error) {
      // A store failure during reservation — report it, then back off and
      // keep polling. Never let it stop the loop.
      this.observer.onDeadLetterFailed(
        { id: "-", queue: this.queueName, name: "reserve", data: undefined as TData, attempt: 0, maxAttempts: 0 },
        error,
      );
      this.scheduleTick(this.pollIntervalMs);
      return;
    }

    // Poll again immediately while jobs keep arriving; only pay the
    // interval once the queue has actually run dry.
    this.scheduleTick(reservedAny ? 0 : this.pollIntervalMs);
  }

  private async process(job: StoredJob<TData>): Promise<void> {
    const active = toActiveJob(job);
    this.observer.onActive(active);

    const idempotencyKey = this.idempotency?.keyFor(active as ActiveJob<never>) ?? null;
    if (idempotencyKey && (await this.isAlreadyProcessed(idempotencyKey))) {
      this.observer.onSkippedAsDuplicate(active, idempotencyKey);
      await this.store.complete(job);
      return;
    }

    const startedAt = this.now();

    try {
      await this.processor(active);
    } catch (error) {
      await this.handleFailure(job, active, error);
      return;
    }

    if (idempotencyKey) await this.markProcessed(idempotencyKey);
    await this.store.complete(job);
    this.observer.onCompleted(active, this.now() - startedAt);
  }

  private async handleFailure(job: StoredJob<TData>, active: ActiveJob<TData>, error: unknown): Promise<void> {
    const failedReason = describeError(error);

    if (job.attemptsMade < job.opts.attempts) {
      const retryInMs = computeBackoffDelayMs(job.attemptsMade, job.opts.backoff);
      await this.store.retry(job, this.now() + retryInMs, failedReason);
      this.observer.onRetried(active, error, retryInMs);
      return;
    }

    await this.store.fail(job, failedReason);
    this.observer.onFailed(active, error);
    await this.moveToDeadLetter(job, active, failedReason);
  }

  private async moveToDeadLetter(
    job: StoredJob<TData>,
    active: ActiveJob<TData>,
    failedReason: string,
  ): Promise<void> {
    if (!this.deadLetterQueue) return;

    try {
      await this.deadLetterQueue.add(
        job.name,
        {
          originalQueue: job.queue,
          originalJobId: job.id,
          jobName: job.name,
          data: job.data,
          attemptsMade: job.attemptsMade,
          failedReason,
          failedAt: new Date(this.now()).toISOString(),
        },
        // Deterministic id: re-dead-lettering the same job (possible if a
        // duplicate slipped through) parks one entry, not two.
        { jobId: `dead:${job.queue}:${job.id}` },
      );
    } catch (error) {
      this.observer.onDeadLetterFailed(active, error);
    }
  }

  /**
   * Both idempotency-store calls are best-effort. If the store is
   * unreachable the correct behaviour is to run the job (at-least-once
   * beats never), not to fail it — losing de-duplication is a degraded
   * mode, losing the work is a bug.
   */
  private async isAlreadyProcessed(key: string): Promise<boolean> {
    try {
      return await this.idempotency!.store.isProcessed(key);
    } catch {
      return false;
    }
  }

  private async markProcessed(key: string): Promise<void> {
    try {
      await this.idempotency!.store.markProcessed(key, this.idempotency!.ttlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS);
    } catch {
      // Swallowed deliberately — the job's actual work already succeeded.
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return "[unstringifiable error]";
  }
}
