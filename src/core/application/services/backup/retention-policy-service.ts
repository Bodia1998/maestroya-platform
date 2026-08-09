import type { BackupRecord } from "@/domain/entities/backup";

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * Pure retention-policy evaluation — decides which of a target's existing
 * backups are now eligible for expiry, given its `RetentionPolicy`. Takes
 * the full list of backups for a target (as `BackupRecordRepository.
 * listByTarget` already returns them) rather than querying itself, so this
 * is unit-testable with hand-built `BackupRecord` fixtures and no
 * database — the same "pure function over already-fetched data" shape
 * `collectConfigHealth`/`collectAnalyticsHealth` use for their own
 * decisions.
 */
export class RetentionPolicyService {
  /**
   * Backups eligible for expiry right now: past their own `expiresAt`,
   * currently in a terminal-success status (`COMPLETED`/`VERIFIED`/
   * `RESTORED` — never `FAILED`, which has no artifact to expire, and
   * never already `EXPIRED`), **and** outside the newest
   * `retentionPolicy.minRetainedBackups` of the target's successful
   * backups. That floor is evaluated per-target across *all* of a
   * target's backups, not per-policy-instance, so a policy change that
   * shortens `retentionDays` can never immediately erase every recovery
   * point for a target that has not backed up recently.
   */
  selectExpired(backups: readonly BackupRecord[], now: Date): BackupRecord[] {
    const successful = backups
      .filter((backup) => backup.status === "COMPLETED" || backup.status === "VERIFIED" || backup.status === "RESTORED")
      .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));

    const [newest] = successful;
    if (!newest) return [];

    const minRetained = newest.retentionPolicy.minRetainedBackups;
    const protectedIds = new Set(successful.slice(0, minRetained).map((backup) => backup.id));

    return successful.filter((backup) => !protectedIds.has(backup.id) && backup.isExpired(now));
  }
}
