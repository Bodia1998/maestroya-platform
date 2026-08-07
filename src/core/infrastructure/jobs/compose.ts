import "server-only";

import { env } from "@/infrastructure/config/env";
import { getRedisClient } from "@/infrastructure/cache/redis-client-factory";
import { createJobStore } from "@/infrastructure/jobs/job-store-factory";
import { createJobLifecycleObserver, type JobLifecycleObserver } from "@/infrastructure/jobs/job-observability";
import { JobScheduler } from "@/infrastructure/jobs/job-scheduler";
import type { QueueCounts } from "@/infrastructure/jobs/job-types";
import { Queue } from "@/infrastructure/jobs/queue";
import { collectQueueHealth, DISABLED_QUEUE_HEALTH, type QueueHealthReport } from "@/infrastructure/jobs/queue-health";

/**
 * Module 45 — Background Jobs (Roadmap Module 12).
 *
 * Composition root for the background-job runtime — the same manual,
 * no-DI-container convention as every other `compose.ts` in this
 * codebase (see `infrastructure/events/compose.ts` and
 * `application/use-cases/auth/compose.ts`): module-level singletons,
 * plain exported factory functions, no reflection.
 *
 * This file owns exactly three things and deliberately knows nothing
 * about domain events (that integration lives in
 * `infrastructure/events/event-bus-factory.ts`, which registers *into*
 * the runtime here):
 *
 *  1. **The registry** of every queue and worker in the process, so that
 *     shutdown and health reporting have one place to enumerate them.
 *  2. **Lifecycle** — `startBackgroundJobs()` / `shutdownBackgroundJobs()`,
 *     called from `instrumentation.ts`'s existing boot and SIGTERM/SIGINT
 *     hooks. This module adds no signal handlers of its own; hooking into
 *     the one graceful-shutdown path that already exists is the whole
 *     point.
 *  3. **Health** — `getBackgroundJobsHealth()`, consumed by the existing
 *     `/api/health/ready` route.
 */

/** The minimal shape the runtime needs from a queue — see `Queue`. */
interface RegisteredQueue {
  readonly name: string;
  getCounts(): Promise<QueueCounts>;
  close(): Promise<void>;
}

/** The minimal shape the runtime needs from a worker — see `Worker`. */
interface RegisteredWorker {
  readonly queueName: string;
  start(): void;
  close(): Promise<void>;
}

class BackgroundJobRuntime {
  private readonly queues = new Map<string, RegisteredQueue>();
  private readonly workers: RegisteredWorker[] = [];
  readonly scheduler = new JobScheduler();
  private started = false;

  registerQueue(queue: RegisteredQueue): void {
    if (this.queues.has(queue.name)) {
      throw new Error(`A queue named ${JSON.stringify(queue.name)} is already registered.`);
    }
    this.queues.set(queue.name, queue);
  }

  registerWorker(worker: RegisteredWorker): void {
    this.workers.push(worker);
    // A worker registered after start() (lazily, on first use of the
    // event bus in a serverless invocation) must not sit idle waiting for
    // a start() that already happened.
    if (this.started) worker.start();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const worker of this.workers) worker.start();
    if (this.scheduler.scheduleNames.length > 0) this.scheduler.start();
  }

  /**
   * Stops accepting work, then waits for in-flight jobs. Workers close
   * before queues so a job cannot be enqueued into a queue that is
   * already closed by a handler still finishing up.
   *
   * `allSettled`, not `all`: one worker failing to close must not leave
   * the others un-closed and the process hanging on SIGTERM.
   */
  async close(): Promise<void> {
    this.started = false;
    this.scheduler.stop();
    await Promise.allSettled(this.workers.map((worker) => worker.close()));
    await Promise.allSettled([...this.queues.values()].map((queue) => queue.close()));
  }

  async health(): Promise<QueueHealthReport> {
    if (this.queues.size === 0) return DISABLED_QUEUE_HEALTH;
    return collectQueueHealth([...this.queues.values()], getRedisClient() ? "redis" : "memory");
  }

  get isStarted(): boolean {
    return this.started;
  }

  get queueNames(): string[] {
    return [...this.queues.keys()];
  }
}

let runtime: BackgroundJobRuntime | null = null;

export function getBackgroundJobRuntime(): BackgroundJobRuntime {
  if (!runtime) runtime = new BackgroundJobRuntime();
  return runtime;
}

/**
 * Creates a queue wired to the shared `JobStore` and the shared
 * observability hooks, and registers it for shutdown and health
 * reporting. The only supported way to create a queue — a queue built
 * directly with `new Queue(...)` would be invisible to both.
 */
export function createManagedQueue<TData>(name: string): Queue<TData> {
  const queue = new Queue<TData>(name, {
    store: createJobStore(),
    observer: getJobObserver(),
  });
  getBackgroundJobRuntime().registerQueue(queue);
  return queue;
}

let observer: JobLifecycleObserver | null = null;

export function getJobObserver(): JobLifecycleObserver {
  if (!observer) observer = createJobLifecycleObserver();
  return observer;
}

/** Concurrency and retry settings, read once from the validated env. */
export const jobDefaults = {
  get concurrency(): number {
    return env.QUEUE_CONCURRENCY;
  },
  get maxAttempts(): number {
    return env.QUEUE_MAX_ATTEMPTS;
  },
} as const;

/**
 * Starts every registered worker and the scheduler. Called once from
 * `instrumentation.ts`, *after* it has imported the modules that
 * register subscribers — so the event worker never reserves a job for a
 * handler that has not been registered yet.
 */
export function startBackgroundJobs(): void {
  getBackgroundJobRuntime().start();
}

/**
 * Graceful shutdown. Idempotent, and safe to call when nothing was ever
 * started — both matter because `instrumentation.ts` may invoke it from
 * either SIGTERM or SIGINT on a process that never enabled queued
 * dispatch at all.
 */
export async function shutdownBackgroundJobs(): Promise<void> {
  if (!runtime) return;
  await runtime.close();
}

export async function getBackgroundJobsHealth(): Promise<QueueHealthReport> {
  if (!runtime) return DISABLED_QUEUE_HEALTH;
  return runtime.health();
}

/** Exposed for tests only — drops the runtime so the next call rebuilds it. */
export const __testing = {
  reset(): void {
    runtime = null;
    observer = null;
  },
};
