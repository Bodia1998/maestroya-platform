import { DISASTER_RECOVERY_PLAN_CATALOG } from "@/application/services/recovery/disaster-recovery-plans";
import type { RecoveryReadinessInput, RecoveryReadinessReport } from "@/application/services/recovery/recovery-readiness-service";
import type { RecoveryReadinessService } from "@/application/services/recovery/recovery-readiness-service";
import type { BackupTarget } from "@/domain/entities/backup";
import type { BackupRecordRepository } from "@/domain/repositories/backup-record-repository";
import type { RecoveryExecutionRepository } from "@/domain/repositories/recovery-execution-repository";

/** Which `BackupTarget` each catalog plan's RPO/backup freshness is evaluated against. Kept here (not on `DisasterRecoveryPlan` itself) since it's a query-composition detail, not part of the runbook the plan represents. */
const PLAN_TARGETS: Readonly<Record<string, BackupTarget>> = {
  "database-outage-recovery": "DATABASE",
  "storage-outage-recovery": "FILE_STORAGE",
};

export interface GetRecoveryReadinessDependencies {
  backupRepository: BackupRecordRepository;
  recoveryRepository: RecoveryExecutionRepository;
  readiness: RecoveryReadinessService;
  now: () => Date;
}

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * Assembles `RecoveryReadinessService`'s required inputs (the freshest
 * completed backup per plan's target, the most recent successful drill
 * per plan) from the repositories, then delegates the pure evaluation.
 * The read path both an admin readiness dashboard and `checks.
 * disasterRecovery` in `/api/health/ready` share, so both always agree.
 */
export class GetRecoveryReadinessUseCase {
  constructor(private readonly deps: GetRecoveryReadinessDependencies) {}

  async execute(): Promise<RecoveryReadinessReport> {
    const inputs: RecoveryReadinessInput[] = await Promise.all(
      DISASTER_RECOVERY_PLAN_CATALOG.map(async (plan) => {
        const target = PLAN_TARGETS[plan.id] ?? "DATABASE";
        const [latestCompletedBackup, lastSuccessfulDrill] = await Promise.all([
          this.deps.backupRepository.findLatestCompletedByTarget(target),
          this.deps.recoveryRepository.findLatestSuccessfulDrillByPlanId(plan.id),
        ]);
        return { plan, target, latestCompletedBackup, lastSuccessfulDrill };
      }),
    );

    return this.deps.readiness.evaluate(inputs, this.deps.now());
  }
}
