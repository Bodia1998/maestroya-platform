import "server-only";

import { createErrorReporter } from "@/infrastructure/observability/error-reporter-factory";
import { logger } from "@/infrastructure/observability/logger";
import type { ActiveJob } from "@/infrastructure/jobs/job-types";

/**
 * Module 45 — Background Jobs (Roadmap Module 12).
 *
 * Job lifecycle observability, wired entirely into the **existing**
 * observability stack: `logger` (Module 25) for the structured JSON line
 * and `createErrorReporter()` (Module 39, Sentry) for exhausted
 * failures. No new logger, no new transport, no new tracing system — the
 * job layer emits through exactly the same two seams every route handler
 * and use case already uses, so job telemetry lands in the same place as
 * everything else with no extra operational setup.
 *
 * ## What is reported where, and why
 * - `queued` / `active` / `completed` → `logger.debug`. High-volume,
 *   individually uninteresting; useful when tracing one job by id, noise
 *   at `info` in production. (`LOG_LEVEL` gates them out by default.)
 * - `retried` → `logger.warn`. A failure happened, but the system is
 *   still expected to recover on its own. Not Sentry-worthy: reporting
 *   every transient blip that self-heals is how a Sentry project becomes
 *   ignorable.
 * - `failed` (attempts exhausted, job dead-lettered) → `logger.error`
 *   **and** `createErrorReporter().reportException`. This is work the
 *   platform accepted and then permanently failed to do — an audit-log
 *   entry that will now never be written, a notification a user will
 *   never receive. Always operationally significant, always reported.
 *
 * The `source: "background-job"` tag matches the one the existing
 * `api/cron/expire-workflows` route already uses for its own failures,
 * so both kinds of background work group together in Sentry rather than
 * splitting into two conventions.
 */
export interface JobLifecycleObserver {
  onQueued(job: { id: string; queue: string; name: string; delayMs: number }): void;
  onActive(job: ActiveJob): void;
  onCompleted(job: ActiveJob, durationMs: number): void;
  onRetried(job: ActiveJob, error: unknown, retryInMs: number): void;
  onFailed(job: ActiveJob, error: unknown): void;
  onSkippedAsDuplicate(job: ActiveJob, idempotencyKey: string): void;
  /**
   * The dead-letter enqueue for an exhausted job itself failed — the one
   * case where the payload is genuinely lost rather than parked. Always
   * reported separately from `onFailed`, because "the job failed" and
   * "we could not even record that the job failed" need different
   * operator responses.
   */
  onDeadLetterFailed(job: ActiveJob, error: unknown): void;
}

export function createJobLifecycleObserver(): JobLifecycleObserver {
  return {
    onQueued(job) {
      logger.debug("job_queued", { jobId: job.id, queue: job.queue, jobName: job.name, delayMs: job.delayMs });
    },

    onActive(job) {
      logger.debug("job_active", {
        jobId: job.id,
        queue: job.queue,
        jobName: job.name,
        attempt: job.attempt,
        maxAttempts: job.maxAttempts,
      });
    },

    onCompleted(job, durationMs) {
      logger.debug("job_completed", {
        jobId: job.id,
        queue: job.queue,
        jobName: job.name,
        attempt: job.attempt,
        durationMs,
      });
    },

    onRetried(job, error, retryInMs) {
      logger.warn("job_retry_scheduled", {
        jobId: job.id,
        queue: job.queue,
        jobName: job.name,
        attempt: job.attempt,
        maxAttempts: job.maxAttempts,
        retryInMs,
        error,
      });
    },

    onFailed(job, error) {
      logger.error("job_failed_permanently", {
        jobId: job.id,
        queue: job.queue,
        jobName: job.name,
        attempt: job.attempt,
        maxAttempts: job.maxAttempts,
        error,
      });

      createErrorReporter().reportException(error, {
        tags: { source: "background-job", queue: job.queue, jobName: job.name },
        extra: { jobId: job.id, attempt: job.attempt, maxAttempts: job.maxAttempts },
      });
    },

    onSkippedAsDuplicate(job, idempotencyKey) {
      logger.debug("job_skipped_duplicate", {
        jobId: job.id,
        queue: job.queue,
        jobName: job.name,
        idempotencyKey,
      });
    },

    onDeadLetterFailed(job, error) {
      logger.error("job_dead_letter_failed", {
        jobId: job.id,
        queue: job.queue,
        jobName: job.name,
        error,
      });

      createErrorReporter().reportException(error, {
        tags: { source: "background-job", queue: job.queue, jobName: job.name, stage: "dead-letter" },
        extra: { jobId: job.id },
      });
    },
  };
}

/**
 * A no-op observer for tests and for callers that want a queue with no
 * telemetry at all — same "null object beats an optional callback"
 * convention as `NullFailureReporter` (Module 39).
 */
export const nullJobLifecycleObserver: JobLifecycleObserver = {
  onQueued() {},
  onActive() {},
  onCompleted() {},
  onRetried() {},
  onFailed() {},
  onSkippedAsDuplicate() {},
  onDeadLetterFailed() {},
};
