import type { LegacyArchiveStore } from "@/application/ports/legacy-archive-store";
import { verifyLegacyArchive, type ArchivePins, type ArchiveVerification } from "@/domain/services/legacy-archive";

/**
 * Module 167 — verifies an existing archive directory from its files alone (no database, no environment). Usable on a fresh export,
 * on a copy that was moved or restored, or years later. It changes nothing. Unlike the export it does not throw on a failed check:
 * the caller receives every issue (codes, categories, ids — never values).
 *
 * Without `pins` the result establishes INTEGRITY only (the files agree with each other). With the manifest SHA-256 and/or the archive
 * digest recorded at export time it also detects an archive that was rewritten consistently; see `ArchivePins` for what that does and
 * does not prove.
 */
export class VerifyLegacyArchiveUseCase {
  constructor(private readonly store: LegacyArchiveStore) {}

  async execute(archivePath: string, pins: ArchivePins = {}): Promise<ArchiveVerification> {
    return verifyLegacyArchive(await this.store.read(archivePath), pins);
  }
}
