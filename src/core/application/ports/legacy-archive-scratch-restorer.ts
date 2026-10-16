import type { ArchiveIssue } from "@/domain/services/legacy-archive";
import type { ScratchFigures, ScratchRestorePlan } from "@/domain/services/legacy-archive-restore";

export interface ScratchRestoreOutcome {
  /** The archive-shaped schema left in the scratch database, or null when everything was rolled back. */
  schemaName: string | null;
  kept: boolean;
  /** What was measured in the restored tables (also present when issues were found, so the operator can see where it diverges). */
  figures: ScratchFigures;
  issues: ArchiveIssue[];
}

/**
 * Module 167 — loads a verified archive into a DISPOSABLE scratch database and measures the result. Never touches the application
 * schema: it creates one new schema of its own. By default everything is rolled back after the checks; the schema is kept only when
 * the caller asks for it AND every check passed.
 */
export interface LegacyArchiveScratchRestorer {
  restore(plan: ScratchRestorePlan, options: { keepSchema: boolean }): Promise<ScratchRestoreOutcome>;
}
