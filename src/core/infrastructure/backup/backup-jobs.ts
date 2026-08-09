import type { BackupTarget } from "@/domain/entities/backup";
import type { ActiveJob } from "@/infrastructure/jobs/job-types";

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * The job vocabulary of the scheduled backup pipeline — this module's
 * analogue of `sms-jobs.ts`/`analytics-refresh-jobs.ts`. Adds no retry/
 * backoff/dead-letter machinery of its own (Module 45's `Worker` already
 * implements all three).
 *
 * One job runs a backup **and then applies retention** for the same
 * target immediately afterward, rather than two separate jobs — a
 * retention sweep is only ever meaningful right after a new backup
 * potentially pushed an old one out of the `minRetainedBackups` floor, so
 * coupling them keeps the schedule simple (one cron entry per target) and
 * guarantees retention is never silently skipped by a scheduler hiccup
 * that drops one of two independently-scheduled jobs.
 */

export const BACKUP_QUEUE_NAME = "backup-run";
export const BACKUP_DEAD_LETTER_QUEUE_NAME = "backup-run-dead-letter";

export interface BackupRunJobData {
  target: BackupTarget;
  /** `"scheduled"` for the cron-driven run, or an operator-supplied reason for a manual trigger. */
  reason: string;
}

/**
 * Enqueue-time idempotency for a manually-triggered ("back up now") run —
 * scoped to the current minute so a double-click/double-submit collapses
 * into one job, while a genuinely repeated manual trigger a few minutes
 * later still runs. Scheduled runs need no equivalent: `JobScheduler`
 * already assigns its own deterministic per-occurrence id (see
 * `job-scheduler.ts`), so `registerScheduledBackups()` never calls this.
 */
export function manualBackupRunJobId(target: BackupTarget, now: Date): string {
  const minuteBucket = Math.floor(now.getTime() / 60_000);
  return `backup:manual:${target}:${minuteBucket}`;
}

/** Execution-time idempotency key — stable across an at-least-once retry of the identical enqueued job. */
export function backupRunJobIdempotencyKey(job: ActiveJob<BackupRunJobData>): string {
  return `backup:${job.id}`;
}
