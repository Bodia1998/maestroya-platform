import type { BackupRecord, BackupType } from "@/domain/entities/backup";

export interface BackupSchedulePolicy {
  /** How often a `FULL` backup is required, regardless of how many incrementals ran since. */
  fullBackupIntervalDays: number;
}

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * Decides whether the next backup for a target should be `FULL` or
 * `INCREMENTAL` — pure decision logic over the target's most recent
 * backup, independent of any provider or schedule mechanism. Used by
 * `CreateBackupUseCase` for every backup, scheduled or manually
 * triggered, so a manual "back up now" call gets the identical type
 * decision a cron-triggered one would.
 */
export class BackupPlanningService {
  /**
   * `FULL` when: there is no prior successful backup for the target, the
   * most recent successful backup is itself older than
   * `fullBackupIntervalDays`, or the most recent successful backup is not
   * itself a `FULL` (an incremental chain must always be anchored to a
   * full backup, never chained onto another incremental — restoring an
   * incremental requires applying it on top of the full it was taken
   * against, and only ever the one immediately before it in a fresh
   * chain, to keep restore a fixed two-step operation rather than an
   * unbounded replay).
   */
  decideNextBackupType(latestSuccessful: BackupRecord | null, policy: BackupSchedulePolicy, now: Date): BackupType {
    if (!latestSuccessful || !latestSuccessful.completedAt) return "FULL";

    // A chain may only ever be one incremental deep in this module's
    // model (see this class's own doc comment) — once the latest
    // successful backup is itself an incremental, the next one must go
    // back to `FULL` rather than chaining a second incremental onto it.
    if (latestSuccessful.type === "INCREMENTAL") return "FULL";

    const ageMs = now.getTime() - latestSuccessful.completedAt.getTime();
    const intervalMs = policy.fullBackupIntervalDays * 24 * 60 * 60 * 1000;
    return ageMs >= intervalMs ? "FULL" : "INCREMENTAL";
  }
}
