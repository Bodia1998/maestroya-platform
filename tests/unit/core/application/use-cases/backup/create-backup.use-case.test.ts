import { describe, expect, it, vi } from "vitest";

import { BackupPlanningService } from "@/application/services/backup/backup-planning-service";
import { BackupValidationService } from "@/application/services/backup/backup-validation-service";
import { IntegrityCheckService } from "@/application/services/backup/integrity-check-service";
import { CreateBackupUseCase } from "@/application/use-cases/backup/create-backup.use-case";
import type { BackupRecord } from "@/domain/entities/backup";
import { RetentionPolicy } from "@/domain/entities/backup";
import type { BackupRecordRepository } from "@/domain/repositories/backup-record-repository";
import type { DatabaseBackupProvider } from "@/application/ports/database-backup-provider";

const artifact = { locationUri: "/tmp/db.dump", sizeBytes: 1024, checksumSha256: "a".repeat(64) };

function last<T>(items: readonly T[]): T {
  const value = items[items.length - 1];
  if (value === undefined) throw new Error("Expected at least one item.");
  return value;
}

function fakeRepository(): BackupRecordRepository & { saved: BackupRecord[] } {
  const saved: BackupRecord[] = [];
  return {
    saved,
    save: vi.fn(async (record: BackupRecord) => {
      saved.push(record);
    }),
    findById: vi.fn(async () => null),
    findLatestByTarget: vi.fn(async () => null),
    findLatestCompletedByTarget: vi.fn(async () => null),
    listByTarget: vi.fn(async () => []),
  };
}

function buildUseCase(overrides: { databaseProvider?: DatabaseBackupProvider } = {}) {
  const repository = fakeRepository();
  const databaseProvider = overrides.databaseProvider ?? {
    createBackup: vi.fn().mockResolvedValue(artifact),
    restoreBackup: vi.fn(),
    verifyBackup: vi.fn().mockResolvedValue({ intact: true }),
    deleteBackup: vi.fn(),
  };
  const storageProvider = {
    createBackup: vi.fn().mockResolvedValue(artifact),
    restoreBackup: vi.fn(),
    verifyBackup: vi.fn().mockResolvedValue({ intact: true }),
    deleteBackup: vi.fn(),
  };

  const useCase = new CreateBackupUseCase({
    repository,
    databaseProvider,
    storageProvider,
    planning: new BackupPlanningService(),
    validation: new BackupValidationService(),
    integrity: new IntegrityCheckService(),
    generateId: () => "backup-1",
    now: () => new Date("2026-06-01T00:00:00.000Z"),
  });

  return { useCase, repository, databaseProvider, storageProvider };
}

describe("application/use-cases/backup/create-backup.use-case", () => {
  const input = {
    target: "DATABASE" as const,
    retentionPolicy: new RetentionPolicy(30, 3),
    schedulePolicy: { fullBackupIntervalDays: 7 },
  };

  it("runs a full backup end to end and ends up VERIFIED", async () => {
    const { useCase, repository } = buildUseCase();
    const record = await useCase.execute(input);

    expect(record.status).toBe("VERIFIED");
    expect(record.type).toBe("FULL");
    // PENDING, RUNNING, COMPLETED, VERIFIED — one save per transition.
    expect(repository.save).toHaveBeenCalledTimes(4);
  });

  it("marks the record FAILED and rethrows when the provider rejects", async () => {
    const databaseProvider = {
      createBackup: vi.fn().mockRejectedValue(new Error("pg_dump exited with code 1")),
      restoreBackup: vi.fn(),
      verifyBackup: vi.fn(),
      deleteBackup: vi.fn(),
    };
    const { useCase, repository } = buildUseCase({ databaseProvider });

    await expect(useCase.execute(input)).rejects.toThrow("pg_dump exited with code 1");
    const failedRecord = last(repository.saved);
    expect(failedRecord.status).toBe("FAILED");
    expect(failedRecord.failureReason).toBe("pg_dump exited with code 1");
  });

  it("marks the record FAILED when the artifact fails validation", async () => {
    const databaseProvider = {
      createBackup: vi.fn().mockResolvedValue({ locationUri: "", sizeBytes: 0, checksumSha256: "bad" }),
      restoreBackup: vi.fn(),
      verifyBackup: vi.fn(),
      deleteBackup: vi.fn(),
    };
    const { useCase, repository } = buildUseCase({ databaseProvider });

    await expect(useCase.execute(input)).rejects.toThrow();
    expect(last(repository.saved).status).toBe("FAILED");
  });

  it("marks the record FAILED when the integrity check fails after completion", async () => {
    const databaseProvider = {
      createBackup: vi.fn().mockResolvedValue(artifact),
      restoreBackup: vi.fn(),
      verifyBackup: vi.fn().mockResolvedValue({ intact: false, reason: "corrupted" }),
      deleteBackup: vi.fn(),
    };
    const { useCase, repository } = buildUseCase({ databaseProvider });

    await expect(useCase.execute(input)).rejects.toThrow(/corrupted/);
    expect(last(repository.saved).status).toBe("FAILED");
  });
});
