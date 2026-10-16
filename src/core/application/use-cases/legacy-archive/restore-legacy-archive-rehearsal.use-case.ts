import type { LegacyArchiveScratchRestorer } from "@/application/ports/legacy-archive-scratch-restorer";
import type { LegacyArchiveStore } from "@/application/ports/legacy-archive-store";
import type { ArchiveIssue, ArchivePins } from "@/domain/services/legacy-archive";
import { invoiceNetPosition, planScratchRestore, type InvoiceNetPosition, type ScratchFigures } from "@/domain/services/legacy-archive-restore";

export interface RestoreRehearsalResult {
  ok: boolean;
  issues: ArchiveIssue[];
  /** Null when the schema was rolled back (the default). */
  keptSchema: string | null;
  figures: ScratchFigures;
  invoiceNet: InvoiceNetPosition[];
  manifestSha256: string;
  archiveDigest: string;
}

/**
 * Module 167 — restore rehearsal. Reads an archive, REFUSES to proceed unless it verifies (and matches the pinned digests, if given),
 * loads it into an archive-shaped schema of a disposable database and checks counts, checksums, exact totals and references against
 * the manifest. It never touches the application schema and, unless asked to keep the schema, leaves nothing behind.
 */
export class RestoreLegacyArchiveRehearsalUseCase {
  constructor(
    private readonly store: LegacyArchiveStore,
    private readonly restorer: LegacyArchiveScratchRestorer,
  ) {}

  async execute(archivePath: string, options: { keepSchema: boolean; pins?: ArchivePins }): Promise<RestoreRehearsalResult> {
    const files = await this.store.read(archivePath);
    const plan = planScratchRestore(files, options.pins ?? {}); // throws ArchiveVerificationFailedError: nothing is loaded
    const outcome = await this.restorer.restore(plan, { keepSchema: options.keepSchema });
    return {
      ok: outcome.issues.length === 0,
      issues: outcome.issues,
      keptSchema: outcome.kept ? outcome.schemaName : null,
      figures: outcome.figures,
      invoiceNet: invoiceNetPosition(outcome.figures),
      manifestSha256: plan.manifestSha256,
      archiveDigest: plan.archiveDigest,
    };
  }
}
