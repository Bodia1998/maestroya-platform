import type { ArchiveFile } from "@/domain/services/legacy-archive";

/** A directory that has been fully written but not yet published under its final name. */
export interface StagedLegacyArchive {
  readonly stagingPath: string;
  readonly targetPath: string;
}

/**
 * Module 167 — where an archive is written and read back.
 *
 * Publishing is two-phase so a failed or unverified export never leaves something that looks like an archive: `stage` writes every
 * file into a private staging location, the caller reads it back and verifies it, and only then `commit` makes it visible under the
 * final name (and read-only). `discard` removes a staging location this store created. An existing target is never overwritten.
 */
export interface LegacyArchiveStore {
  stage(targetPath: string, files: readonly ArchiveFile[]): Promise<StagedLegacyArchive>;
  readStaged(staged: StagedLegacyArchive): Promise<ArchiveFile[]>;
  commit(staged: StagedLegacyArchive): Promise<void>;
  discard(staged: StagedLegacyArchive): Promise<void>;
  /** Reads every file of an existing archive directory (for verification). */
  read(archivePath: string): Promise<ArchiveFile[]>;
}
