import { describe, expect, it, vi } from "vitest";

import { RetentionPolicyService } from "@/application/services/backup/retention-policy-service";
import { ApplyRetentionPolicyUseCase } from "@/application/use-cases/backup/apply-retention-policy.use-case";
import { BackupRecord, RetentionPolicy } from "@/domain/entities/backup";
import type { BackupRecordRepository } from "@/domain/repositories/backup-record-repository";

const policy = new RetentionPolicy(1, 1);

function expiredBackup(id: string, completedAt: Date): BackupRecord {
  const record = BackupRecord.schedule(id, "DATABASE", "FULL", policy, completedAt);
  record.markRunning(completedAt);
  record.markCompleted({ sizeBytes: 1, checksumSha256: "a".repeat(64), locationUri: `/tmp/${id}` }, completedAt);
  return record;
}

function fakeRepository(backups: BackupRecord[]): BackupRecordRepository & { saved: BackupRecord[] } {
  const saved: BackupRecord[] = [];
  return {
    saved,
    save: vi.fn(async (record: BackupRecord) => {
      saved.push(record);
    }),
    findById: vi.fn(async () => null),
    findLatestByTarget: vi.fn(async () => null),
    findLatestCompletedByTarget: vi.fn(async () => null),
    listByTarget: vi.fn(async () => backups),
  };
}

describe("application/use-cases/backup/apply-retention-policy.use-case", () => {
  const now = new Date("2026-06-10T00:00:00.000Z");

  it("expires eligible backups and deletes their artifacts", async () => {
    const oldest = expiredBackup("oldest", new Date("2026-01-01T00:00:00.000Z"));
    const newest = expiredBackup("newest", new Date("2026-06-01T00:00:00.000Z"));
    const repository = fakeRepository([oldest, newest]);
    const databaseProvider = {
      createBackup: vi.fn(),
      restoreBackup: vi.fn(),
      verifyBackup: vi.fn(),
      deleteBackup: vi.fn().mockResolvedValue(undefined),
    };
    const storageProvider = { createBackup: vi.fn(), restoreBackup: vi.fn(), verifyBackup: vi.fn(), deleteBackup: vi.fn() };

    const useCase = new ApplyRetentionPolicyUseCase({
      repository,
      databaseProvider,
      storageProvider,
      retention: new RetentionPolicyService(),
      now: () => now,
    });

    const result = await useCase.execute("DATABASE");

    expect(result.expiredCount).toBe(1);
    expect(oldest.status).toBe("EXPIRED");
    expect(newest.status).toBe("COMPLETED"); // protected by minRetainedBackups=1
    expect(databaseProvider.deleteBackup).toHaveBeenCalledTimes(1);
  });

  it("still marks the record EXPIRED even when artifact deletion fails, and reports the failure", async () => {
    const oldest = expiredBackup("oldest", new Date("2026-01-01T00:00:00.000Z"));
    const newest = expiredBackup("newest", new Date("2026-06-01T00:00:00.000Z"));
    const repository = fakeRepository([oldest, newest]);
    const databaseProvider = {
      createBackup: vi.fn(),
      restoreBackup: vi.fn(),
      verifyBackup: vi.fn(),
      deleteBackup: vi.fn().mockRejectedValue(new Error("filesystem unreachable")),
    };
    const storageProvider = { createBackup: vi.fn(), restoreBackup: vi.fn(), verifyBackup: vi.fn(), deleteBackup: vi.fn() };

    const useCase = new ApplyRetentionPolicyUseCase({
      repository,
      databaseProvider,
      storageProvider,
      retention: new RetentionPolicyService(),
      now: () => now,
    });

    const result = await useCase.execute("DATABASE");

    expect(oldest.status).toBe("EXPIRED");
    expect(result.deletionFailures).toEqual([{ backupId: "oldest", reason: "filesystem unreachable" }]);
  });

  it("is a no-op when nothing is eligible for expiry", async () => {
    const repository = fakeRepository([]);
    const databaseProvider = { createBackup: vi.fn(), restoreBackup: vi.fn(), verifyBackup: vi.fn(), deleteBackup: vi.fn() };
    const storageProvider = { createBackup: vi.fn(), restoreBackup: vi.fn(), verifyBackup: vi.fn(), deleteBackup: vi.fn() };

    const useCase = new ApplyRetentionPolicyUseCase({
      repository,
      databaseProvider,
      storageProvider,
      retention: new RetentionPolicyService(),
      now: () => now,
    });

    const result = await useCase.execute("DATABASE");
    expect(result).toEqual({ target: "DATABASE", expiredCount: 0, deletionFailures: [] });
  });
});
