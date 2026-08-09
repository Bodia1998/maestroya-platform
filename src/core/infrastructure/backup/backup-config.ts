import "server-only";

import type { BackupSchedulePolicy } from "@/application/services/backup/backup-planning-service";
import { RetentionPolicy } from "@/domain/entities/backup";
import { env } from "@/infrastructure/config/env";

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * Turns the validated `BACKUP_*` environment variables into the resolved
 * shapes the rest of this module reads — the same "decide once, from the
 * validated env, in a single named place" role `resolveTracingConfig()`
 * plays for Module 51. Kept separate from `compose.ts` so the decision
 * ("is backup enabled, and with what policy?") is unit-testable without
 * constructing a provider, queue, or worker.
 */
export interface BackupConfig {
  enabled: boolean;
  storageDir: string;
  scheduleCron: string;
  retentionPolicy: RetentionPolicy;
  schedulePolicy: BackupSchedulePolicy;
}

export function resolveBackupConfig(): BackupConfig {
  return {
    enabled: env.BACKUP_ENABLED === "true",
    storageDir: env.BACKUP_STORAGE_DIR,
    scheduleCron: env.BACKUP_SCHEDULE_CRON,
    retentionPolicy: new RetentionPolicy(env.BACKUP_RETENTION_DAYS, env.BACKUP_MIN_RETAINED_BACKUPS),
    schedulePolicy: { fullBackupIntervalDays: env.BACKUP_FULL_INTERVAL_DAYS },
  };
}
