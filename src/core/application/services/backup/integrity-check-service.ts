import type { BackupArtifact, BackupVerificationResult } from "@/application/ports/database-backup-provider";
import { IntegrityCheckError } from "@/domain/errors/domain-error";

/** The minimal shape this service needs from either backup provider port. */
export interface IntegrityVerifier {
  verifyBackup(artifact: BackupArtifact): Promise<BackupVerificationResult>;
}

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * Orchestrates a backup-integrity check: delegates the actual checksum
 * recomputation to whichever provider (`DatabaseBackupProvider`/
 * `StorageBackupProvider`) produced the artifact — this service has no
 * hashing logic of its own, since "how do I re-read these particular
 * bytes" is inherently provider-specific — and translates a failed check
 * into `IntegrityCheckError` so every caller (a use case, a scheduled
 * verification sweep) gets one consistent failure type regardless of
 * which provider or target was involved.
 */
export class IntegrityCheckService {
  /** @throws IntegrityCheckError if the artifact's current bytes no longer match its recorded checksum. */
  async assertIntact(verifier: IntegrityVerifier, artifact: BackupArtifact): Promise<void> {
    const result = await verifier.verifyBackup(artifact);
    if (!result.intact) {
      throw new IntegrityCheckError(
        `Backup artifact at ${artifact.locationUri} failed integrity verification${result.reason ? `: ${result.reason}` : "."}`,
      );
    }
  }
}
