import { randomUUID } from "node:crypto";

import { nullTracer, type TracingPort } from "@/application/ports/tracing";
import type { JobStore } from "@/infrastructure/jobs/job-store";
import type { JobLifecycleObserver } from "@/infrastructure/jobs/job-observability";
import { nullJobLifecycleObserver } from "@/infrastructure/jobs/job-observability";
import type { JobOptions, QueueCounts, StoredJob } from "@/infrastructure/jobs/job-types";
import { normalizeJobOptions } from "@/infrastructure/jobs/job-types";

export interface QueueDependencies {
  store: JobStore;
  observer?: JobLifecycleObserver;
  /** Injectable for deterministic tests; defaults to `Date.now`. */
  now?: () => number;
  /**
   * Module 51 — Distributed Tracing. Used for one thing only: capturing
   * the active W3C trace context onto the job at enqueue time
   * (`StoredJob.trace`), so the worker that eventually runs it can join
   * the same trace. Defaults to the port's `nullTracer`, whose `inject()`
   * returns an empty carrier — so with tracing off (the default) no
   * `trace` field is written and a stored job is exactly what it always
   * was. Injected rather than imported so this class stays a pure,
   * dependency-free transport, testable with no composition root.
   */
  tracer?: TracingPort;
}

/**
 * Module 45 — Background Jobs (Roadmap Module 12).
 *
 * The producer half of the queue, with BullMQ's `Queue` surface:
 * `add(name, data, opts)`, `getCounts()`, `drain()`, `close()`. It holds
 * no jobs itself — everything goes straight to the injected `JobStore`
 * (see `job-store.ts` for why that split exists).
 *
 * `add()` returns the created job, or `null` when a job with the same
 * `opts.jobId` already exists in this queue. A `null` return is a
 * **success**, not an error: it means "that work is already scheduled",
 * which is the entire point of passing a `jobId`. Callers that want
 * at-most-once enqueue semantics get them for free by supplying a
 * deterministic id and ignoring `null`.
 */
export class Queue<TData = unknown> {
  private readonly store: JobStore;
  private readonly observer: JobLifecycleObserver;
  private readonly now: () => number;
  private readonly tracer: TracingPort;
  private closed = false;

  constructor(
    readonly name: string,
    dependencies: QueueDependencies,
  ) {
    this.store = dependencies.store;
    this.observer = dependencies.observer ?? nullJobLifecycleObserver;
    this.now = dependencies.now ?? Date.now;
    this.tracer = dependencies.tracer ?? nullTracer;
  }

  async add(jobName: string, data: TData, options?: JobOptions): Promise<StoredJob<TData> | null> {
    if (this.closed) {
      throw new Error(`Cannot add job "${jobName}" to queue "${this.name}": the queue is closed.`);
    }

    const opts = normalizeJobOptions(options);
    const delay = options?.delay ?? 0;
    const createdAt = this.now();

    // Module 51 — Distributed Tracing: an empty carrier (no tracing, or
    // nothing active) leaves the field off entirely rather than storing
    // `trace: {}`, so the persisted job shape is unchanged when tracing
    // is disabled — see `StoredJob.trace`.
    const trace = this.tracer.inject();

    const job: StoredJob<TData> = {
      id: options?.jobId ?? randomUUID(),
      queue: this.name,
      name: jobName,
      data,
      opts,
      attemptsMade: 0,
      createdAt,
      processAt: createdAt + delay,
      ...(Object.keys(trace).length > 0 ? { trace } : {}),
    };

    const added = (await this.store.add(job)) as StoredJob<TData> | null;
    if (added) {
      this.observer.onQueued({ id: job.id, queue: this.name, name: jobName, delayMs: delay });
    }
    return added;
  }

  async getCounts(): Promise<QueueCounts> {
    return this.store.counts(this.name, this.now());
  }

  /** Discards every waiting/delayed job. Used by tests and by operators; never on the normal path. */
  async drain(): Promise<void> {
    await this.store.drain(this.name);
  }

  /**
   * Stops this queue accepting new jobs. Does not close the underlying
   * store — the store is shared across every queue in the process and is
   * closed once, by `jobs/compose.ts`'s shutdown path.
   */
  async close(): Promise<void> {
    this.closed = true;
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
