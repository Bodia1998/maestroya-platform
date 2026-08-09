/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * The technical, swappable-provider seam for actually taking and
 * restoring a database backup — the module's analogue of Module 44's
 * `CacheProvider`/Module 53's `SecretsProvider`: application/domain code
 * depends on this interface only, never on `pg_dump`, a cloud snapshot
 * API, or any other concrete mechanism. Today's implementation
 * (`infrastructure/backup/pg-dump-database-backup-provider.ts`) shells out
 * to PostgreSQL's own `pg_dump`/`pg_restore`; a managed-Postgres-provider
 * snapshot API (RDS, Cloud SQL, Neon, ...) is a drop-in alternative
 * implementation of this same interface, never a reason to touch
 * `application/services/backup/*` or `BackupRecord`.
 *
 * Every method reports failure by rejecting its promise — `BackupRecord`
 * itself has no knowledge of *why* a backup failed, only that it did (see
 * that aggregate's `markFailed`); translating a rejected promise into
 * that call is the calling use case's job, not this port's.
 */
export interface BackupArtifact {
  /** Where the backup was written — an opaque URI/path from the caller's perspective, meaningful only to the provider that produced it and the one that will restore it. Never logged in full if it could embed credentials — see this module's own "never expose sensitive information" requirement. */
  locationUri: string;
  sizeBytes: number;
  /** Lowercase hex-encoded SHA-256 of the artifact's bytes. */
  checksumSha256: string;
}

export interface BackupVerificationResult {
  /** Whether the artifact's current bytes still match `checksumSha256` computed at backup time — the sole question this port answers; it does not attempt to open/parse the dump. */
  intact: boolean;
  /** Present only when `intact` is `false`. */
  reason?: string;
}

export interface DatabaseBackupProvider {
  /**
   * Produces a full or incremental logical backup of the database and
   * returns where it landed. `since` is the timestamp of the most recent
   * prior backup for `type: "INCREMENTAL"`, and is ignored (may be
   * `null`) for `type: "FULL"`.
   */
  createBackup(type: "FULL" | "INCREMENTAL", since: Date | null): Promise<BackupArtifact>;

  /** Restores the database from a previously created artifact. Callers must have already run restore validation (`RestoreValidationService`) — this method performs no business-rule checks of its own, only the mechanical restore. */
  restoreBackup(artifact: BackupArtifact): Promise<void>;

  /** Recomputes the artifact's checksum and compares it against the one recorded at backup time, without restoring anything. */
  verifyBackup(artifact: BackupArtifact): Promise<BackupVerificationResult>;

  /** Permanently removes a backup artifact — called by retention enforcement once a `BackupRecord` has been marked `EXPIRED`. A no-op, not an error, when the artifact is already gone. */
  deleteBackup(artifact: BackupArtifact): Promise<void>;
}
