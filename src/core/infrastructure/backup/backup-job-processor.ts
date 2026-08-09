import type { ApplyRetentionPolicyUseCase } from "@/application/use-cases/backup/apply-retention-policy.use-case";
import type { CreateBackupUseCase } from "@/application/use-cases/backup/create-backup.use-case";
import type { RetentionPolicy } from "@/domain/entities/backup";
import type { BackupSchedulePolicy } from "@/application/services/backup/backup-planning-service";
import type { BackupRunJobData } from "@/infrastructure/backup/backup-jobs";
import type { JobProcessor } from "@/infrastructure/jobs/worker";
import { logger } from "@/infrastructure/observability/logger";

export interface BackupJobHandlers {
  createBackup: CreateBackupUseCase;
  applyRetention: ApplyRetentionPolicyUseCase;
  retentionPolicy: RetentionPolicy;
  schedulePolicy: BackupSchedulePolicy;
}

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * The `JobProcessor` the backup `Worker` runs: creates the backup, then
 * — regardless of whether the backup that just ran was itself expected to
 * change anything — applies retention for the same target. Errors from
 * `createBackup` are thrown, not swallowed (the same "a throw means
 * retry, then dead-letter" contract every other processor in this
 * codebase follows), so a failed scheduled backup is visible via the
 * queue's dead-letter entries and this module's own health check, never
 * silently absorbed.
 *
 * Retention failures are logged, not thrown — a retention sweep that
 * couldn't run this cycle will simply run again next cycle (it is
 * idempotent: `RetentionPolicyService.selectExpired` always recomputes
 * from current state), so failing the whole job (and therefore
 * dead-lettering a backup that itself *succeeded*) would be the wrong
 * trade.
 */
export function createBackupJobProcessor(handlers: BackupJobHandlers): JobProcessor<BackupRunJobData> {
  return async (job) => {
    const { target } = job.data;

    await handlers.createBackup.execute({
      target,
      retentionPolicy: handlers.retentionPolicy,
      schedulePolicy: handlers.schedulePolicy,
    });

    try {
      await handlers.applyRetention.execute(target);
    } catch (error) {
      logger.error("backup_retention_sweep_failed", { target, error });
    }
  };
}
