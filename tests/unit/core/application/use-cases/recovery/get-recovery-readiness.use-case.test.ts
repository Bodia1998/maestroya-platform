import { describe, expect, it, vi } from "vitest";

import { RecoveryReadinessService } from "@/application/services/recovery/recovery-readiness-service";
import { GetRecoveryReadinessUseCase } from "@/application/use-cases/recovery/get-recovery-readiness.use-case";
import { DISASTER_RECOVERY_PLAN_CATALOG } from "@/application/services/recovery/disaster-recovery-plans";
import type { BackupRecordRepository } from "@/domain/repositories/backup-record-repository";
import type { RecoveryExecutionRepository } from "@/domain/repositories/recovery-execution-repository";

describe("application/use-cases/recovery/get-recovery-readiness.use-case", () => {
  it("evaluates every plan in the catalog and never throws with no backups/drills yet", async () => {
    const backupRepository: BackupRecordRepository = {
      save: vi.fn(),
      findById: vi.fn(),
      findLatestByTarget: vi.fn(async () => null),
      findLatestCompletedByTarget: vi.fn(async () => null),
      listByTarget: vi.fn(async () => []),
    };
    const recoveryRepository: RecoveryExecutionRepository = {
      save: vi.fn(),
      findById: vi.fn(),
      findLatestByPlanId: vi.fn(async () => null),
      findLatestSuccessfulDrillByPlanId: vi.fn(async () => null),
    };

    const useCase = new GetRecoveryReadinessUseCase({
      backupRepository,
      recoveryRepository,
      readiness: new RecoveryReadinessService(),
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    const report = await useCase.execute();

    expect(report.status).toBe("not_ready");
    expect(report.plans).toHaveLength(DISASTER_RECOVERY_PLAN_CATALOG.length);
  });
});
