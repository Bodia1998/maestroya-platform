import { describe, expect, it, vi } from "vitest";

import { IntegrityCheckService } from "@/application/services/backup/integrity-check-service";
import { RestoreValidationService } from "@/application/services/recovery/restore-validation-service";
import { RestoreBackupUseCase } from "@/application/use-cases/recovery/restore-backup.use-case";
import { BackupRecord, RetentionPolicy } from "@/domain/entities/backup";
import { NotFoundError, RestoreValidationError } from "@/domain/errors/domain-error";
import type { BackupRecordRepository } from "@/domain/repositories/backup-record-repository";

const policy = new RetentionPolicy(30, 3);
const now = new Date("2026-06-01T00:00:00.000Z");

function completedRecord(): BackupRecord {
  const record = BackupRecord.schedule("backup-1", "DATABASE", "FULL", policy, now);
  record.markRunning(now);
  record.markCompleted({ sizeBytes: 10, checksumSha256: "a".repeat(64), locationUri: "/tmp/x" }, now);
  return record;
}

function buildUseCase(record: BackupRecord | null, overrides: { verifyBackup?: ReturnType<typeof vi.fn> } = {}) {
  const repository: BackupRecordRepository = {
    save: vi.fn(async () => {}),
    findById: vi.fn(async () => record),
    findLatestByTarget: vi.fn(async () => null),
    findLatestCompletedByTarget: vi.fn(async () => null),
    listByTarget: vi.fn(async () => []),
  };
  const databaseProvider = {
    createBackup: vi.fn(),
    restoreBackup: vi.fn().mockResolvedValue(undefined),
    verifyBackup: overrides.verifyBackup ?? vi.fn().mockResolvedValue({ intact: true }),
    deleteBackup: vi.fn(),
  };
  const storageProvider = { createBackup: vi.fn(), restoreBackup: vi.fn(), verifyBackup: vi.fn(), deleteBackup: vi.fn() };

  const useCase = new RestoreBackupUseCase({
    repository,
    databaseProvider,
    storageProvider,
    restoreValidation: new RestoreValidationService(),
    integrity: new IntegrityCheckService(),
    now: () => now,
  });

  return { useCase, repository, databaseProvider };
}

describe("application/use-cases/recovery/restore-backup.use-case", () => {
  it("throws NotFoundError for an unknown backup id", async () => {
    const { useCase } = buildUseCase(null);
    await expect(useCase.execute("missing", "DATABASE")).rejects.toThrow(NotFoundError);
  });

  it("throws RestoreValidationError for a non-restorable backup", async () => {
    const record = BackupRecord.schedule("backup-2", "DATABASE", "FULL", policy, now);
    const { useCase } = buildUseCase(record);
    await expect(useCase.execute("backup-2", "DATABASE")).rejects.toThrow(RestoreValidationError);
  });

  it("re-verifies integrity immediately before restoring, and marks the record RESTORED on success", async () => {
    const record = completedRecord();
    const { useCase, repository, databaseProvider } = buildUseCase(record);

    const restored = await useCase.execute("backup-1", "DATABASE");

    expect(databaseProvider.verifyBackup).toHaveBeenCalledTimes(1);
    expect(databaseProvider.restoreBackup).toHaveBeenCalledTimes(1);
    expect(restored.restoredAt).toEqual(now);
    expect(repository.save).toHaveBeenCalledWith(record);
  });

  it("never calls restoreBackup when the pre-restore integrity check fails", async () => {
    const record = completedRecord();
    const { useCase, databaseProvider } = buildUseCase(record, {
      verifyBackup: vi.fn().mockResolvedValue({ intact: false, reason: "corrupted" }),
    });

    await expect(useCase.execute("backup-1", "DATABASE")).rejects.toThrow(/corrupted/);
    expect(databaseProvider.restoreBackup).not.toHaveBeenCalled();
  });
});
