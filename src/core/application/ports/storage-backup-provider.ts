import type { BackupArtifact, BackupVerificationResult } from "@/application/ports/database-backup-provider";

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * The file/object-storage counterpart of `DatabaseBackupProvider` — same
 * interface shape deliberately (`BackupArtifact`/`BackupVerificationResult`
 * are shared types), so `BackupPlanningService`/`BackupValidationService`/
 * `IntegrityCheckService` work identically regardless of which target a
 * `BackupRecord` names, and a caller never needs a target-specific branch
 * to reason about an artifact.
 *
 * Today's implementation
 * (`infrastructure/backup/cloudinary-manifest-storage-backup-provider.ts`)
 * backs up the platform's uploaded files (Module 18's Cloudinary storage)
 * as a **resource manifest**, not a re-hosted copy of every binary — see
 * that class's own doc comment for why that is the correct backup unit
 * for storage this platform does not itself hold the bytes for. A
 * self-hosted-filesystem deployment would instead implement this
 * interface with a `tar`/directory-snapshot provider; this port makes
 * that swap possible without touching anything above it.
 */
export interface StorageBackupProvider {
  /** No incremental/full distinction at the storage layer today — a manifest snapshot is cheap enough to always be a full capture (see the Cloudinary implementation's own doc comment); `BackupPlanningService` still records every storage `BackupRecord` as `type: "FULL"` for that reason. */
  createBackup(): Promise<BackupArtifact>;

  /** Restores from a previously captured manifest/artifact. What "restore" means for a manifest-only backup is documented on the concrete implementation — this port only guarantees the operation completes or rejects. */
  restoreBackup(artifact: BackupArtifact): Promise<void>;

  verifyBackup(artifact: BackupArtifact): Promise<BackupVerificationResult>;

  deleteBackup(artifact: BackupArtifact): Promise<void>;
}
