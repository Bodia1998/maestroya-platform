import type { RestoreBackupUseCase } from "@/application/use-cases/recovery/restore-backup.use-case";
import type { DisasterRecoveryService, RecoveryStepHandlers } from "@/application/services/recovery/disaster-recovery-service";
import { findDisasterRecoveryPlan } from "@/application/services/recovery/disaster-recovery-plans";
import type { RecoveryExecution } from "@/domain/entities/disaster-recovery";
import type { BackupTarget } from "@/domain/entities/backup";
import { RecoveryPlanNotFoundError } from "@/domain/errors/domain-error";
import type { GetBackupStatusUseCase } from "@/application/use-cases/backup/get-backup-status.use-case";
import type { IntegrityCheckService, IntegrityVerifier } from "@/application/services/backup/integrity-check-service";
import { NotFoundError } from "@/domain/errors/domain-error";

export interface RunDisasterRecoveryDependencies {
  service: DisasterRecoveryService;
  restoreBackup: RestoreBackupUseCase;
  getBackupStatus: GetBackupStatusUseCase;
  integrity: IntegrityCheckService;
  databaseVerifier: IntegrityVerifier;
  storageVerifier: IntegrityVerifier;
}

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * The single caller-facing entry point for running a disaster-recovery
 * plan — looks the plan up by id, wires its three automated steps
 * (`verify-latest-backup-integrity`, `restore-database-from-latest-backup`,
 * `run-recovery-verification-queries`) to this module's own backup use
 * cases, and delegates the actual step-by-step execution to
 * `DisasterRecoveryService`. Kept as a thin adapter deliberately — the
 * execution *algorithm* lives in `DisasterRecoveryService` (unit-tested
 * against fake handlers), this class only supplies the *real* handlers.
 *
 * Both a genuine incident (`isDrill: false`) and a scheduled readiness
 * drill (`isDrill: true`, see `RecoveryReadinessService`) call this same
 * method — a drill is not a separate, lighter code path that could drift
 * from what a real recovery actually does.
 */
export class RunDisasterRecoveryUseCase {
  constructor(private readonly deps: RunDisasterRecoveryDependencies) {}

  async execute(planId: string, target: BackupTarget, triggeredBy: string, isDrill: boolean): Promise<RecoveryExecution> {
    const plan = findDisasterRecoveryPlan(planId);
    if (!plan) throw new RecoveryPlanNotFoundError(planId);

    const verifier = target === "DATABASE" ? this.deps.databaseVerifier : this.deps.storageVerifier;

    const handlers: RecoveryStepHandlers = {
      "verify-latest-backup-integrity": async () => {
        const status = await this.deps.getBackupStatus.execute(target);
        const candidate = status.latestCompleted;
        if (!candidate?.locationUri || !candidate.checksumSha256 || candidate.sizeBytes === null) {
          throw new NotFoundError("BackupRecord", target);
        }
        await this.deps.integrity.assertIntact(verifier, {
          locationUri: candidate.locationUri,
          checksumSha256: candidate.checksumSha256,
          sizeBytes: candidate.sizeBytes,
        });
      },
      "restore-database-from-latest-backup": async () => {
        const status = await this.deps.getBackupStatus.execute(target);
        if (!status.latestCompleted) throw new NotFoundError("BackupRecord", target);
        await this.deps.restoreBackup.execute(status.latestCompleted.id, target);
      },
      "run-recovery-verification-queries": async () => {
        const status = await this.deps.getBackupStatus.execute(target);
        if (!status.latestCompleted?.restoredAt) {
          throw new Error(`Target ${target}'s latest backup was not restored — recovery verification cannot proceed.`);
        }
      },
    };

    return this.deps.service.execute(plan, handlers, triggeredBy, isDrill);
  }
}
