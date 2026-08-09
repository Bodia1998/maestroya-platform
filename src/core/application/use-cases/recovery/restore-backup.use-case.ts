import type { DatabaseBackupProvider } from "@/application/ports/database-backup-provider";
import type { StorageBackupProvider } from "@/application/ports/storage-backup-provider";
import type { IntegrityCheckService } from "@/application/services/backup/integrity-check-service";
import type { RestoreValidationService } from "@/application/services/recovery/restore-validation-service";
import type { BackupRecord, BackupTarget } from "@/domain/entities/backup";
import { NotFoundError } from "@/domain/errors/domain-error";
import type { BackupRecordRepository } from "@/domain/repositories/backup-record-repository";

export interface RestoreBackupUseCaseDependencies {
  repository: BackupRecordRepository;
  databaseProvider: DatabaseBackupProvider;
  storageProvider: StorageBackupProvider;
  restoreValidation: RestoreValidationService;
  integrity: IntegrityCheckService;
  now: () => Date;
}

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * Restores a specific, caller-identified `BackupRecord` — used both by an
 * operator-triggered manual restore and by `DisasterRecoveryService`'s
 * automated "restore the latest verified backup" step. Runs, in strict
 * order: lookup → lifecycle/target validation → **integrity
 * re-verification immediately before restoring** (a backup that was
 * `VERIFIED` an hour or a month ago is not guaranteed to still be intact
 * — checking again right before restore is the only point that actually
 * matters) → the provider's restore call → `markRestored`.
 *
 * A restore is deliberately never retried automatically by this class —
 * restoring the wrong data twice is worse than restoring it once and
 * failing loudly the second time; a caller that wants a retry must invoke
 * this use case again explicitly.
 */
export class RestoreBackupUseCase {
  constructor(private readonly deps: RestoreBackupUseCaseDependencies) {}

  async execute(backupId: string, expectedTarget: BackupTarget): Promise<BackupRecord> {
    const record = await this.deps.repository.findById(backupId);
    if (!record) throw new NotFoundError("BackupRecord", backupId);

    this.deps.restoreValidation.validate(record, expectedTarget, this.deps.now());

    const artifact = {
      locationUri: record.locationUri!,
      checksumSha256: record.checksumSha256!,
      sizeBytes: record.sizeBytes!,
    };
    const provider = expectedTarget === "DATABASE" ? this.deps.databaseProvider : this.deps.storageProvider;

    await this.deps.integrity.assertIntact(provider, artifact);
    await provider.restoreBackup(artifact);

    record.markRestored(this.deps.now());
    await this.deps.repository.save(record);

    return record;
  }
}
