import type { DatabaseBackupProvider } from "@/application/ports/database-backup-provider";
import type { StorageBackupProvider } from "@/application/ports/storage-backup-provider";
import type { BackupSchedulePolicy } from "@/application/services/backup/backup-planning-service";
import type { BackupPlanningService } from "@/application/services/backup/backup-planning-service";
import type { BackupValidationService } from "@/application/services/backup/backup-validation-service";
import type { IntegrityCheckService } from "@/application/services/backup/integrity-check-service";
import type { RetentionPolicy} from "@/domain/entities/backup";
import { BackupRecord, type BackupTarget } from "@/domain/entities/backup";
import type { BackupRecordRepository } from "@/domain/repositories/backup-record-repository";

export interface CreateBackupUseCaseDependencies {
  repository: BackupRecordRepository;
  databaseProvider: DatabaseBackupProvider;
  storageProvider: StorageBackupProvider;
  planning: BackupPlanningService;
  validation: BackupValidationService;
  integrity: IntegrityCheckService;
  generateId: () => string;
  now: () => Date;
}

export interface CreateBackupInput {
  target: BackupTarget;
  retentionPolicy: RetentionPolicy;
  schedulePolicy: BackupSchedulePolicy;
}

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * Runs one backup end to end: plan (full vs incremental) → execute via
 * the target's provider → validate the returned artifact → persist as
 * `RUNNING` → mark `COMPLETED` → verify integrity → mark `VERIFIED`. The
 * single entry point both the scheduled backup job and any manual
 * "back up now" trigger call, so both get identical planning, validation,
 * and integrity behaviour — see `BackupPlanningService`'s own doc comment.
 *
 * ## Fail safely
 * A `BackupRecord` is written to the repository as `PENDING` immediately,
 * before the provider is ever called, then transitioned to `RUNNING`
 * before the provider call — so an operator inspecting backup status
 * during (or after a crash during) a long-running backup sees an
 * accurate `RUNNING`/`FAILED` record rather than nothing at all. Any
 * failure — from the provider, from validation, or from the integrity
 * check — is caught, recorded on the record via `markFailed`, persisted,
 * and then re-thrown so the caller (a job processor) still sees the
 * failure and can retry/alert, exactly as `RefreshAnalyticsReadModelUseCase`
 * does for its own errors.
 */
export class CreateBackupUseCase {
  constructor(private readonly deps: CreateBackupUseCaseDependencies) {}

  async execute(input: CreateBackupInput): Promise<BackupRecord> {
    const latestSuccessful = await this.deps.repository.findLatestCompletedByTarget(input.target);
    const type = this.deps.planning.decideNextBackupType(latestSuccessful, input.schedulePolicy, this.deps.now());

    const record = BackupRecord.schedule(this.deps.generateId(), input.target, type, input.retentionPolicy, this.deps.now());
    await this.deps.repository.save(record);

    record.markRunning(this.deps.now());
    await this.deps.repository.save(record);

    try {
      const provider = input.target === "DATABASE" ? this.deps.databaseProvider : this.deps.storageProvider;
      const artifact =
        input.target === "DATABASE"
          ? await this.deps.databaseProvider.createBackup(type, latestSuccessful?.completedAt ?? null)
          : await this.deps.storageProvider.createBackup();

      this.deps.validation.validate(artifact, input.target);
      record.markCompleted(artifact, this.deps.now());
      await this.deps.repository.save(record);

      await this.deps.integrity.assertIntact(provider, artifact);
      record.markVerified(this.deps.now());
      await this.deps.repository.save(record);

      return record;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // The artifact-producing/validating steps above never persisted a
      // secret or credential onto `reason` — provider implementations are
      // required to raise plain, safe-to-log error messages (see
      // `DatabaseBackupProvider`'s own doc comment).
      record.markFailed(reason, this.deps.now());
      await this.deps.repository.save(record);
      throw error;
    }
  }
}
