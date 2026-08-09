import type { DatabaseBackupProvider } from "@/application/ports/database-backup-provider";
import type { StorageBackupProvider } from "@/application/ports/storage-backup-provider";
import type { RetentionPolicyService } from "@/application/services/backup/retention-policy-service";
import type { BackupTarget } from "@/domain/entities/backup";
import type { BackupRecordRepository } from "@/domain/repositories/backup-record-repository";

export interface ApplyRetentionPolicyDependencies {
  repository: BackupRecordRepository;
  databaseProvider: DatabaseBackupProvider;
  storageProvider: StorageBackupProvider;
  retention: RetentionPolicyService;
  now: () => Date;
}

export interface RetentionSweepResult {
  target: BackupTarget;
  expiredCount: number;
  /** Backups whose provider-side artifact deletion failed — the
   *  `BackupRecord` itself is still marked `EXPIRED` regardless (see this
   *  class's own doc comment for why), so these are reported for operator
   *  follow-up cleanup, not retried automatically here. */
  deletionFailures: { backupId: string; reason: string }[];
}

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * Enforces retention: finds every backup for a target that
 * `RetentionPolicyService.selectExpired` says is now eligible, deletes its
 * underlying artifact via the matching provider, and marks the
 * `BackupRecord` `EXPIRED` regardless of whether that deletion succeeded.
 *
 * ## Why the record still expires even if artifact deletion fails
 * A retention *record* answers "is this backup still a valid recovery
 * point" — the answer is "no" the moment it is past its policy, whether
 * or not the underlying storage happens to still hold stale bytes. Never
 * offering an expired backup as a restore candidate again
 * (`RestoreValidationService` already independently enforces this from
 * `isExpired()`) is the correctness property this use case must guarantee
 * unconditionally; cleaning up the now-orphaned artifact is a best-effort
 * operational nicety layered on top, and its failure is reported rather
 * than allowed to block the guarantee.
 */
export class ApplyRetentionPolicyUseCase {
  constructor(private readonly deps: ApplyRetentionPolicyDependencies) {}

  async execute(target: BackupTarget): Promise<RetentionSweepResult> {
    const backups = await this.deps.repository.listByTarget(target);
    const expired = this.deps.retention.selectExpired(backups, this.deps.now());
    const provider = target === "DATABASE" ? this.deps.databaseProvider : this.deps.storageProvider;

    const deletionFailures: RetentionSweepResult["deletionFailures"] = [];

    for (const backup of expired) {
      if (backup.locationUri && backup.checksumSha256 && backup.sizeBytes !== null) {
        try {
          await provider.deleteBackup({
            locationUri: backup.locationUri,
            checksumSha256: backup.checksumSha256,
            sizeBytes: backup.sizeBytes,
          });
        } catch (error) {
          deletionFailures.push({ backupId: backup.id, reason: error instanceof Error ? error.message : String(error) });
        }
      }

      backup.markExpired(this.deps.now());
      await this.deps.repository.save(backup);
    }

    return { target, expiredCount: expired.length, deletionFailures };
  }
}
