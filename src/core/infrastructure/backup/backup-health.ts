import type { BackupRecord, BackupTarget } from "@/domain/entities/backup";
import type { QueueCounts } from "@/infrastructure/jobs/job-types";

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * The shape `/api/health/ready` reports under `checks.backup`. Joins
 * every other Module-4x/5x check there in the route's established
 * "operational visibility only" category — reported, never allowed to
 * change the response's overall `status` or HTTP code. A backup that
 * failed or is overdue does not mean this instance cannot serve HTTP
 * traffic; it means the platform's own recovery posture is degraded,
 * which `checks.disasterRecovery` (see `recovery-health.ts`) surfaces
 * more specifically via RPO/readiness terms. `"disabled"`
 * (`BACKUP_ENABLED=false`, the default) is a healthy, normal state,
 * exactly like `checks.queue`'s own `"disabled"`.
 */
export type BackupHealthStatus = "ok" | "degraded" | "disabled";

export interface BackupTargetHealth {
  target: BackupTarget;
  latestStatus: BackupRecord["status"] | "never_run";
  latestCompletedAt: string | null;
  ageHoursSinceLastCompleted: number | null;
}

export interface BackupHealthReport {
  status: BackupHealthStatus;
  targets: BackupTargetHealth[];
  queue: QueueCounts | null;
  issues: string[];
}

export const DISABLED_BACKUP_HEALTH: BackupHealthReport = { status: "disabled", targets: [], queue: null, issues: [] };

export interface BackupHealthInput {
  target: BackupTarget;
  latest: BackupRecord | null;
  latestCompleted: BackupRecord | null;
}

/** A target with no successful backup in this many hours is flagged degraded. */
export const MAX_BACKUP_AGE_HOURS = 48;

/**
 * Collects the report from already-fetched status data. Pure and total —
 * a health *check* must never itself become an incident, mirroring
 * `collectConfigHealth`/`collectQueueHealth` exactly.
 */
export function collectBackupHealth(inputs: readonly BackupHealthInput[], queue: QueueCounts | null, now: Date): BackupHealthReport {
  const issues: string[] = [];

  const targets = inputs.map((input): BackupTargetHealth => {
    if (input.latest?.status === "FAILED") {
      issues.push(`Most recent backup for target ${input.target} FAILED: ${input.latest.failureReason ?? "no reason recorded"}.`);
    }

    const ageHours = input.latestCompleted?.completedAt
      ? (now.getTime() - input.latestCompleted.completedAt.getTime()) / (60 * 60 * 1000)
      : null;

    if (ageHours === null) {
      issues.push(`Target ${input.target} has no completed backup yet.`);
    } else if (ageHours > MAX_BACKUP_AGE_HOURS) {
      issues.push(`Target ${input.target}'s freshest completed backup is ${Math.floor(ageHours)} hours old, exceeding the ${MAX_BACKUP_AGE_HOURS}-hour threshold.`);
    }

    return {
      target: input.target,
      latestStatus: input.latest?.status ?? "never_run",
      latestCompletedAt: input.latestCompleted?.completedAt?.toISOString() ?? null,
      ageHoursSinceLastCompleted: ageHours === null ? null : Math.floor(ageHours),
    };
  });

  return { status: issues.length === 0 ? "ok" : "degraded", targets, queue, issues };
}
