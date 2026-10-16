import { ExportLegacyArchiveUseCase } from "@/application/use-cases/legacy-archive/export-legacy-archive.use-case";
import { FsLegacyArchiveStore } from "@/infrastructure/legacy-archive/fs-legacy-archive-store";
import { PrismaLegacyArchiveReader } from "@/infrastructure/database/prisma/repositories/prisma-legacy-archive-reader";

/**
 * Module 167 — composition root of the legacy archive export (plain factory, no DI container).
 *
 * TRUSTED-INTERNAL and READ-ONLY toward the database. Nothing in the application calls this: no route, Server Action, webhook,
 * cron job, queue or scheduler (pinned by a static test) — only `scripts/run-legacy-archive-export.ts`. It reads no environment
 * variable itself and adds no feature flag or switch. See docs/MODULE_167_LEGACY_ARCHIVE_RETENTION_EXPORT.md.
 */
export function makeExportLegacyArchiveUseCase() {
  return new ExportLegacyArchiveUseCase(new PrismaLegacyArchiveReader(), new FsLegacyArchiveStore());
}
