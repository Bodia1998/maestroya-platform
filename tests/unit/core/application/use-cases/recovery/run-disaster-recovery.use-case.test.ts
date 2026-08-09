import { describe, expect, it, vi } from "vitest";

import { IntegrityCheckService } from "@/application/services/backup/integrity-check-service";
import { DisasterRecoveryService } from "@/application/services/recovery/disaster-recovery-service";
import { RunDisasterRecoveryUseCase } from "@/application/use-cases/recovery/run-disaster-recovery.use-case";
import { BackupRecord, RetentionPolicy } from "@/domain/entities/backup";
import { RecoveryPlanNotFoundError } from "@/domain/errors/domain-error";
import type { RecoveryExecutionRepository } from "@/domain/repositories/recovery-execution-repository";

const policy = new RetentionPolicy(30, 3);
const now = new Date("2026-06-01T00:00:00.000Z");

function completedRecord(restored = false): BackupRecord {
  const record = BackupRecord.schedule("backup-1", "DATABASE", "FULL", policy, now);
  record.markRunning(now);
  record.markCompleted({ sizeBytes: 10, checksumSha256: "a".repeat(64), locationUri: "/tmp/x" }, now);
  if (restored) record.markRestored(now);
  return record;
}

function fakeRecoveryRepository(): RecoveryExecutionRepository {
  return {
    save: vi.fn(async () => {}),
    findById: vi.fn(async () => null),
    findLatestByPlanId: vi.fn(async () => null),
    findLatestSuccessfulDrillByPlanId: vi.fn(async () => null),
  };
}

describe("application/use-cases/recovery/run-disaster-recovery.use-case", () => {
  it("throws RecoveryPlanNotFoundError for an unknown plan id", async () => {
    const useCase = new RunDisasterRecoveryUseCase({
      service: new DisasterRecoveryService({ repository: fakeRecoveryRepository(), generateId: () => "e1", now: () => now }),
      restoreBackup: { execute: vi.fn() } as never,
      getBackupStatus: { execute: vi.fn() } as never,
      integrity: new IntegrityCheckService(),
      databaseVerifier: { verifyBackup: vi.fn() },
      storageVerifier: { verifyBackup: vi.fn() },
    });

    await expect(useCase.execute("no-such-plan", "DATABASE", "test", true)).rejects.toThrow(RecoveryPlanNotFoundError);
  });

  it("runs the database-outage-recovery plan end to end and completes", async () => {
    const record = completedRecord();
    const getBackupStatus = {
      execute: vi.fn(async () => ({ target: "DATABASE" as const, latest: record, latestCompleted: record, history: [record] })),
    };
    const restoreBackup = { execute: vi.fn(async () => { record.markRestored(now); return record; }) };

    const useCase = new RunDisasterRecoveryUseCase({
      service: new DisasterRecoveryService({ repository: fakeRecoveryRepository(), generateId: () => "e2", now: () => now }),
      restoreBackup: restoreBackup as never,
      getBackupStatus: getBackupStatus as never,
      integrity: new IntegrityCheckService(),
      databaseVerifier: { verifyBackup: vi.fn().mockResolvedValue({ intact: true }) },
      storageVerifier: { verifyBackup: vi.fn() },
    });

    const execution = await useCase.execute("database-outage-recovery", "DATABASE", "unit test", true);

    expect(execution.status).toBe("COMPLETED");
    expect(restoreBackup.execute).toHaveBeenCalledWith("backup-1", "DATABASE");
    // The 4th step ("notify-stakeholders") is non-automated and should be SKIPPED, not run.
    expect(execution.checkpoints.map((checkpoint) => checkpoint.status)).toEqual(["COMPLETED", "COMPLETED", "COMPLETED", "SKIPPED"]);
  });

  it("fails the execution when there is no completed backup to recover from", async () => {
    const getBackupStatus = {
      execute: vi.fn(async () => ({ target: "DATABASE" as const, latest: null, latestCompleted: null, history: [] })),
    };

    const useCase = new RunDisasterRecoveryUseCase({
      service: new DisasterRecoveryService({ repository: fakeRecoveryRepository(), generateId: () => "e3", now: () => now }),
      restoreBackup: { execute: vi.fn() } as never,
      getBackupStatus: getBackupStatus as never,
      integrity: new IntegrityCheckService(),
      databaseVerifier: { verifyBackup: vi.fn() },
      storageVerifier: { verifyBackup: vi.fn() },
    });

    const execution = await useCase.execute("database-outage-recovery", "DATABASE", "unit test", false);
    expect(execution.status).toBe("FAILED");
  });
});
