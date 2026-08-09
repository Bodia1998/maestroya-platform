import type { BackupRecord, BackupTarget } from "@/domain/entities/backup";
import type { DisasterRecoveryPlan, RecoveryExecution } from "@/domain/entities/disaster-recovery";

export type RecoveryReadinessStatus = "ready" | "at_risk" | "not_ready";

export interface RecoveryReadinessReport {
  status: RecoveryReadinessStatus;
  /** One entry per plan in the catalog. */
  plans: PlanReadiness[];
  /** Specific, human-readable reasons `status` is not `"ready"`. Empty when `status` is `"ready"`. */
  issues: string[];
}

export interface PlanReadiness {
  planId: string;
  /** Whether the plan's own RPO is currently being met by the freshest available backup for its associated target — `null` when the plan has no backup at all yet for its target. */
  rpoSatisfied: boolean | null;
  /** Age, in minutes, of the freshest COMPLETED/VERIFIED backup for this plan's target — `null` if none exists. */
  latestBackupAgeMinutes: number | null;
  /** When this plan was last exercised as a drill and reached COMPLETED — `null` if it never has been. */
  lastSuccessfulDrillAt: Date | null;
}

export interface RecoveryReadinessInput {
  plan: DisasterRecoveryPlan;
  target: BackupTarget;
  latestCompletedBackup: BackupRecord | null;
  lastSuccessfulDrill: RecoveryExecution | null;
}

/** A plan not drilled within this many days is flagged `at_risk` — an
 *  untested runbook is a real, if lesser, risk than a missing one. */
export const MAX_DRILL_AGE_DAYS = 90;

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * Pure evaluation of whether the platform is currently ready to execute
 * its disaster-recovery plans if it had to — the DR analogue of
 * `collectConfigHealth`: takes already-fetched facts (the latest backup
 * per target, the latest successful drill per plan) and produces one
 * report, with zero I/O of its own so this stays trivially unit-testable.
 *
 * `"not_ready"` only ever means "this plan's RPO could not currently be
 * met" (no completed backup exists yet, or the freshest one is already
 * older than the plan's own `rpoMinutes`) — the one gap that would
 * genuinely mean unacceptable data loss in a real incident.
 * `"at_risk"` means every RPO is currently satisfied but at least one
 * plan has not been drilled recently enough for that to be trusted —
 * a real, but strictly lesser, concern.
 */
export class RecoveryReadinessService {
  evaluate(inputs: readonly RecoveryReadinessInput[], now: Date): RecoveryReadinessReport {
    const issues: string[] = [];
    let hasNotReady = false;
    let hasAtRisk = false;

    const plans = inputs.map((input) => {
      const latestBackupAgeMinutes = input.latestCompletedBackup?.completedAt
        ? Math.floor((now.getTime() - input.latestCompletedBackup.completedAt.getTime()) / 60_000)
        : null;

      const rpoSatisfied = latestBackupAgeMinutes === null ? null : latestBackupAgeMinutes <= input.plan.rpoMinutes;

      if (rpoSatisfied === null) {
        hasNotReady = true;
        issues.push(`Plan "${input.plan.id}" has no completed backup yet for target ${input.target} — its RPO of ${input.plan.rpoMinutes} minutes cannot currently be met.`);
      } else if (!rpoSatisfied) {
        hasNotReady = true;
        issues.push(`Plan "${input.plan.id}"'s freshest backup is ${latestBackupAgeMinutes} minutes old, exceeding its RPO of ${input.plan.rpoMinutes} minutes.`);
      }

      const lastSuccessfulDrillAt = input.lastSuccessfulDrill?.completedAt ?? null;
      const drillAgeDays = lastSuccessfulDrillAt ? (now.getTime() - lastSuccessfulDrillAt.getTime()) / (24 * 60 * 60 * 1000) : null;
      if (drillAgeDays === null || drillAgeDays > MAX_DRILL_AGE_DAYS) {
        hasAtRisk = true;
        issues.push(
          drillAgeDays === null
            ? `Plan "${input.plan.id}" has never been successfully drilled.`
            : `Plan "${input.plan.id}" was last successfully drilled ${Math.floor(drillAgeDays)} days ago, exceeding the ${MAX_DRILL_AGE_DAYS}-day readiness window.`,
        );
      }

      return {
        planId: input.plan.id,
        rpoSatisfied,
        latestBackupAgeMinutes,
        lastSuccessfulDrillAt,
      };
    });

    return {
      status: hasNotReady ? "not_ready" : hasAtRisk ? "at_risk" : "ready",
      plans,
      issues,
    };
  }
}
