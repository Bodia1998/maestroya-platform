import "server-only";

import type { Span, TracingPort } from "@/application/ports/tracing";
import type { JobLifecycleObserver } from "@/infrastructure/jobs/job-observability";
import type { ActiveJob } from "@/infrastructure/jobs/job-types";

/**
 * Module 51 — Distributed Tracing — background jobs and queues.
 *
 * Instruments Module 45's job runtime through the seam it already
 * provides — `JobLifecycleObserver` — rather than by editing `Queue` or
 * `Worker`. That seam already reports exactly the seven moments this
 * module needs to trace (queued, active, completed, retried, failed,
 * skipped-as-duplicate, dead-letter-failed), it is already injected into
 * every queue and every worker in the process by `jobs/compose.ts`'s
 * `getJobObserver()`, and it is already the place job telemetry goes. Not
 * one line of the queue, the worker, the scheduler or the job store
 * changes.
 *
 * ## Composition, not replacement
 * `withJobTracing(delegate, tracer)` *wraps* the existing logger/Sentry
 * observer (`createJobLifecycleObserver()`), calling it first and
 * unconditionally on every hook. Structured job logs and Sentry
 * dead-letter reports behave exactly as before; tracing is strictly
 * additive, and a throw from the tracing half can never suppress the
 * logging half (each hook is individually guarded).
 *
 * ## The span shape
 *  - **`queue.enqueue <queue>`** (`kind: producer`) — an instantaneous
 *    span at `onQueued`, so an enqueue is visible inside the request span
 *    that caused it, with the queue name, job name and any delay.
 *  - **`job.process <queue>`** (`kind: consumer`) — opened at `onActive`
 *    and closed at whichever terminal hook fires. This is the span that
 *    carries processing duration, attempt number, and the outcome.
 *
 * ## How a job span joins the request that enqueued it
 * `Queue.add` injects the ambient trace context into the job's own
 * `trace` field (see `infrastructure/jobs/queue.ts`), which survives the
 * round trip through the job store — including Redis, since a carrier is
 * a flat string map by construction. `onActive` uses it as the span's
 * parent, so an HTTP request → enqueue → (seconds later, possibly in
 * another process) worker execution is **one trace**, not two unrelated
 * ones. A job with no carrier (enqueued while tracing was off, or by the
 * scheduler at boot) simply starts a new trace — never an error.
 *
 * ## Why spans are held in a `Map` rather than opened with `withSpan`
 * The start and the end of a job genuinely happen in different
 * callbacks; there is no single function to wrap. The map is keyed by
 * job id and every terminal hook deletes its entry, so a job cannot leak
 * an entry — and even a hypothetical missed terminal hook would leak one
 * ended-nowhere span object, never a request, a connection or a job.
 */
export class TracingJobLifecycleObserver implements JobLifecycleObserver {
  private readonly active = new Map<string, { span: Span; startedAt: number }>();

  constructor(
    private readonly delegate: JobLifecycleObserver,
    private readonly tracer: TracingPort,
  ) {}

  onQueued(job: { id: string; queue: string; name: string; delayMs: number }): void {
    this.delegate.onQueued(job);

    guard(() => {
      const span = this.tracer.startSpan(`queue.enqueue ${job.queue}`, {
        kind: "producer",
        attributes: {
          "messaging.system": "maestroya.jobs",
          "messaging.destination.name": job.queue,
          "messaging.operation.name": "enqueue",
          "messaging.message.id": job.id,
          "job.name": job.name,
          "job.delay_ms": job.delayMs,
        },
      });
      span.end();
    });
  }

  onActive(job: ActiveJob): void {
    this.delegate.onActive(job);

    guard(() => {
      const span = this.tracer.startSpan(`job.process ${job.queue}`, {
        kind: "consumer",
        parent: job.trace ?? null,
        attributes: {
          "messaging.system": "maestroya.jobs",
          "messaging.destination.name": job.queue,
          "messaging.operation.name": "process",
          "messaging.message.id": job.id,
          "job.name": job.name,
          "job.attempt": job.attempt,
          "job.max_attempts": job.maxAttempts,
        },
      });
      this.active.set(job.id, { span, startedAt: Date.now() });
    });
  }

  onCompleted(job: ActiveJob, durationMs: number): void {
    this.delegate.onCompleted(job, durationMs);

    guard(() => {
      this.finish(job.id, (span) => {
        span.setAttributes({ "job.outcome": "completed", "job.duration_ms": durationMs });
      });
    });
  }

  onRetried(job: ActiveJob, error: unknown, retryInMs: number): void {
    this.delegate.onRetried(job, error, retryInMs);

    guard(() => {
      this.finish(job.id, (span) => {
        span.recordException(error);
        // Not `setStatus("error")`: a scheduled retry is the system
        // working as designed, and marking it an error would make every
        // self-healing blip show up in the backend's error rate — the
        // same judgement `job-observability.ts` makes by logging retries
        // at `warn` and deliberately not reporting them to Sentry.
        span.addEvent("job.retry_scheduled", { "job.retry_in_ms": retryInMs, "job.attempt": job.attempt });
        span.setAttribute("job.outcome", "retry_scheduled");
      });
    });
  }

  onFailed(job: ActiveJob, error: unknown): void {
    this.delegate.onFailed(job, error);

    guard(() => {
      this.finish(job.id, (span) => {
        span.recordException(error);
        span.setStatus("error", error instanceof Error ? error.message : String(error));
        span.addEvent("job.dead_lettered", { "job.attempt": job.attempt, "job.max_attempts": job.maxAttempts });
        span.setAttribute("job.outcome", "failed");
      });
    });
  }

  onSkippedAsDuplicate(job: ActiveJob, idempotencyKey: string): void {
    this.delegate.onSkippedAsDuplicate(job, idempotencyKey);

    guard(() => {
      this.finish(job.id, (span) => {
        span.addEvent("job.skipped_duplicate", { "job.idempotency_key": idempotencyKey });
        span.setAttribute("job.outcome", "skipped_duplicate");
      });
    });
  }

  onDeadLetterFailed(job: ActiveJob, error: unknown): void {
    this.delegate.onDeadLetterFailed(job, error);

    guard(() => {
      // The job's own span is normally already closed by `onFailed` at
      // this point, so this records a standalone span rather than
      // silently dropping the one case where a payload is genuinely lost
      // — the distinction `onDeadLetterFailed`'s own doc comment insists
      // on keeping visible.
      const span = this.tracer.startSpan(`job.dead_letter_failed ${job.queue}`, {
        kind: "consumer",
        attributes: {
          "messaging.destination.name": job.queue,
          "messaging.message.id": job.id,
          "job.name": job.name,
        },
      });
      span.recordException(error);
      span.setStatus("error", "The dead-letter enqueue itself failed; the job payload is lost.");
      span.end();
    });
  }

  private finish(jobId: string, decorate: (span: Span) => void): void {
    const entry = this.active.get(jobId);
    if (!entry) return;
    this.active.delete(jobId);

    decorate(entry.span);
    entry.span.end();
  }
}

/**
 * Wraps `delegate` only when tracing is on — the disabled path returns
 * the existing logger/Sentry observer unchanged, so the job runtime is
 * byte-for-byte what it was before this module existed.
 */
export function withJobTracing(delegate: JobLifecycleObserver, tracer: TracingPort): JobLifecycleObserver {
  return tracer.enabled ? new TracingJobLifecycleObserver(delegate, tracer) : delegate;
}

/**
 * Observer hooks are called from inside the worker's own try/catch-heavy
 * lifecycle, including its shutdown path. A throw from telemetry there
 * could abort a retry schedule or a dead-letter enqueue — so nothing in
 * this file is allowed to propagate one, on top of `TracingPort`'s own
 * total-by-construction guarantee.
 */
function guard(fn: () => void): void {
  try {
    fn();
  } catch {
    /* tracing must never affect job execution */
  }
}
