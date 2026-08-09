import type { BackupRecord, BackupTarget } from "@/domain/entities/backup";
import { RestoreValidationError } from "@/domain/errors/domain-error";

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * Validates that a specific `BackupRecord` is a legitimate restore
 * candidate *before* `RestoreBackupUseCase` calls into a provider's
 * `restoreBackup()` — the last, cheapest line of defence against
 * restoring the wrong thing, an incomplete backup, or one already past
 * its retention window. Deliberately checks lifecycle/target consistency
 * only; artifact byte-level integrity is `IntegrityCheckService`'s job
 * (run separately, and always, immediately before the actual restore
 * call — see that use case) so the two failure modes ("this record isn't
 * restorable" vs. "this record's bytes are corrupted") stay
 * independently diagnosable.
 */
export class RestoreValidationService {
  /** @throws RestoreValidationError if `record` is not a valid restore candidate for `expectedTarget`, as of `now`. */
  validate(record: BackupRecord, expectedTarget: BackupTarget, now: Date): void {
    if (record.target !== expectedTarget) {
      throw new RestoreValidationError(
        `Backup ${record.id} targets ${record.target}, which does not match the requested restore target ${expectedTarget}.`,
      );
    }
    if (record.status !== "COMPLETED" && record.status !== "VERIFIED") {
      throw new RestoreValidationError(
        `Backup ${record.id} is ${record.status} and cannot be restored — only a COMPLETED or VERIFIED backup is a valid restore candidate.`,
      );
    }
    if (record.isExpired(now)) {
      throw new RestoreValidationError(`Backup ${record.id} expired at ${record.expiresAt?.toISOString()} and can no longer be restored.`);
    }
    if (!record.locationUri || !record.checksumSha256 || record.sizeBytes === null) {
      throw new RestoreValidationError(`Backup ${record.id} is missing artifact metadata required to restore it.`);
    }
  }
}
