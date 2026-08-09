import type { BackupArtifact } from "@/application/ports/database-backup-provider";
import type { BackupTarget } from "@/domain/entities/backup";
import { BackupValidationError } from "@/domain/errors/domain-error";

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * Validates a freshly produced `BackupArtifact` before `CreateBackupUseCase`
 * is allowed to call `BackupRecord.markCompleted()` with it — the backup
 * artifact's own internal-consistency check, distinct from
 * `IntegrityCheckService` (which re-verifies an *existing, previously
 * validated* artifact hasn't since been corrupted) and from
 * `RestoreValidationService` (which asks "is this specific record a valid
 * restore candidate," a question about the `BackupRecord`, not the raw
 * artifact). Pure and total — never touches a provider or the network,
 * only the values a provider already returned.
 */
export class BackupValidationService {
  /** @throws BackupValidationError if the artifact is not internally consistent. */
  validate(artifact: BackupArtifact, target: BackupTarget): void {
    if (!artifact.locationUri || artifact.locationUri.trim().length === 0) {
      throw new BackupValidationError(`Backup artifact for target ${target} has no location.`);
    }
    if (!Number.isFinite(artifact.sizeBytes) || artifact.sizeBytes <= 0) {
      throw new BackupValidationError(
        `Backup artifact for target ${target} has an invalid size (${String(artifact.sizeBytes)} bytes) — an empty or negative-size backup is never valid.`,
      );
    }
    if (!SHA256_HEX_PATTERN.test(artifact.checksumSha256)) {
      throw new BackupValidationError(
        `Backup artifact for target ${target} has a malformed checksum — expected a 64-character lowercase hex SHA-256 digest.`,
      );
    }
  }
}
