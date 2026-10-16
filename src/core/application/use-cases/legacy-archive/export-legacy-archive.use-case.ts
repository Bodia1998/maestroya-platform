import type { LegacyArchiveStore } from "@/application/ports/legacy-archive-store";
import type { LegacyArchiveReader } from "@/domain/repositories/legacy-archive-reader";
import {
  ArchiveVerificationFailedError,
  buildLegacyArchive,
  verifyLegacyArchive,
  type ArchiveFile,
  type ArchiveIssue,
  type LegacyArchiveOptions,
} from "@/domain/services/legacy-archive";
import { LEGACY_ARCHIVE_BLOCKERS } from "@/domain/services/legacy-archive-spec";

export interface ExportLegacyArchiveInput {
  /** Absolute path of a directory that does not exist yet. */
  targetPath: string;
  options: LegacyArchiveOptions;
}

export interface ExportLegacyArchiveResult {
  /** Always COMPLETE: any failure throws, so a result never describes a partial export. */
  status: "COMPLETE";
  targetPath: string;
  generatedAt: Date;
  manifestSha256: string;
  archiveDigest: string;
  totalRecords: number;
  categories: { key: string; recordCount: number; outOfScopeCount: number; controlled: boolean }[];
  /** Ids of the unresolved decisions/gaps written into the manifest. An archive is never reported as approved. */
  unresolvedBlockers: string[];
}

/**
 * Module 167 — exports the legacy archive. READ-ONLY with respect to the database; writes only into a new directory.
 *
 * Sequence (each step fails closed and nothing is published until the last one):
 *  1. read one consistent snapshot through the query-only port;
 *  2. build the archive (validates every value, rejects duplicates, compares counts and exact sums with the database's own
 *     figures) and verify it in memory;
 *  3. stage it, READ IT BACK from disk and verify it again — checksums, counts, ordering, references, totals — and require the
 *     files to be byte-identical to what was built;
 *  4. only then publish it atomically under its final name.
 * Any error discards the staging directory and propagates; there is no "partial success" result. Re-running is safe: an existing
 * target is refused, and the same data yields byte-identical category files and the same `archiveDigest`.
 *
 * TRUSTED-INTERNAL: wired to no route, Server Action, webhook, cron job, queue or scheduler (pinned by a static test); the only
 * entry point is `scripts/run-legacy-archive-export.ts`.
 */
export class ExportLegacyArchiveUseCase {
  constructor(
    private readonly reader: LegacyArchiveReader,
    private readonly store: LegacyArchiveStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: ExportLegacyArchiveInput): Promise<ExportLegacyArchiveResult> {
    const generatedAt = this.now();
    const snapshot = await this.reader.readSnapshot(input.options);
    const built = buildLegacyArchive(snapshot, input.options, generatedAt);

    const inMemory = verifyLegacyArchive(built.files);
    if (!inMemory.ok) throw new ArchiveVerificationFailedError(inMemory.issues);

    const staged = await this.store.stage(input.targetPath, built.files);
    try {
      const readBack = await this.store.readStaged(staged);
      const onDisk = verifyLegacyArchive(readBack);
      if (!onDisk.ok) throw new ArchiveVerificationFailedError(onDisk.issues);
      const differences = compareFiles(built.files, readBack);
      if (differences.length > 0) throw new ArchiveVerificationFailedError(differences);
      await this.store.commit(staged);
    } catch (error) {
      await this.store.discard(staged).catch(() => undefined);
      throw error;
    }

    return {
      status: "COMPLETE",
      targetPath: staged.targetPath,
      generatedAt,
      manifestSha256: built.manifestSha256,
      archiveDigest: built.manifest.archiveDigest,
      totalRecords: built.manifest.totalRecords,
      categories: built.manifest.categories.map((c) => ({ key: c.key, recordCount: c.recordCount, outOfScopeCount: c.outOfScopeCount, controlled: c.controlled })),
      unresolvedBlockers: LEGACY_ARCHIVE_BLOCKERS.map((b) => b.id),
    };
  }
}

function compareFiles(built: readonly ArchiveFile[], readBack: readonly ArchiveFile[]): ArchiveIssue[] {
  const issues: ArchiveIssue[] = [];
  const back = new Map(readBack.map((f) => [f.name, f.content]));
  for (const file of built) {
    const other = back.get(file.name);
    if (!other || !file.content.equals(other)) issues.push({ code: "READBACK_DIFFERS", detail: `"${file.name}" read back from storage differs from what was built` });
  }
  if (back.size !== built.length) issues.push({ code: "READBACK_FILE_SET_DIFFERS", detail: "the stored file set differs from what was built" });
  return issues;
}
