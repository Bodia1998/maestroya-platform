import { RestoreLegacyArchiveRehearsalUseCase } from "@/application/use-cases/legacy-archive/restore-legacy-archive-rehearsal.use-case";
import { PrismaLegacyArchiveScratchRestorer } from "@/infrastructure/database/prisma/repositories/prisma-legacy-archive-scratch-restorer";
import { FsLegacyArchiveStore } from "@/infrastructure/legacy-archive/fs-legacy-archive-store";

/**
 * Module 167 — composition root of the scratch-restore rehearsal. Separate from export/verify: it is the only one that WRITES to a
 * database, and only to a schema it creates itself. Its `PrismaClient` reads `DATABASE_URL`, which the run config has already
 * required to be a loopback host with a scratch/test database name that the operator authorized explicitly.
 */
export function makeRestoreLegacyArchiveRehearsalUseCase() {
  return new RestoreLegacyArchiveRehearsalUseCase(new FsLegacyArchiveStore(), new PrismaLegacyArchiveScratchRestorer());
}
