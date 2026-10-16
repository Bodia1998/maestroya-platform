import { VerifyLegacyArchiveUseCase } from "@/application/use-cases/legacy-archive/verify-legacy-archive.use-case";
import { FsLegacyArchiveStore } from "@/infrastructure/legacy-archive/fs-legacy-archive-store";

/**
 * Module 167 — composition root of archive verification. Deliberately separate from `compose-export.ts`: verification needs no
 * database and no environment, so it must not import the Prisma client (whose module load validates the environment).
 */
export function makeVerifyLegacyArchiveUseCase() {
  return new VerifyLegacyArchiveUseCase(new FsLegacyArchiveStore());
}
