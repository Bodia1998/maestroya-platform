import type { RecoveryExecution } from "@/domain/entities/disaster-recovery";

/**
 * Module 54 — Backup & Disaster Recovery: repository interface for the
 * `RecoveryExecution` aggregate — the audit trail of every disaster-
 * recovery run (real or drill). Mirrors `BackupRecordRepository`'s own
 * "work with the aggregate class directly" convention.
 */
export interface RecoveryExecutionRepository {
  save(execution: RecoveryExecution): Promise<void>;

  findById(id: string): Promise<RecoveryExecution | null>;

  /** The most recent execution for a plan, drill or real — used by
   *  `RecoveryReadinessService` to check when the plan was last exercised. */
  findLatestByPlanId(planId: string): Promise<RecoveryExecution | null>;

  /** The most recent execution for a plan that both was a drill and
   *  reached `COMPLETED` — the specific "last successful readiness test"
   *  signal `RecoveryReadinessService` reports on, distinct from
   *  `findLatestByPlanId` (which also returns failed/aborted runs and real
   *  incidents). */
  findLatestSuccessfulDrillByPlanId(planId: string): Promise<RecoveryExecution | null>;
}
