import type { BackupRecord, BackupTarget } from "@/domain/entities/backup";

/**
 * Module 54 — Backup & Disaster Recovery: repository interface for the
 * `BackupRecord` aggregate. Same "record + narrow repository interface"
 * convention as `DisputeRepository` — this file works with the aggregate
 * class directly (rather than a plain DTO) because `BackupRecord` already
 * encapsulates every persistence-relevant field behind getters and its own
 * lifecycle methods; a repository implementation only needs to map
 * to/from its own storage row, never re-derive business state.
 */
export interface BackupRecordRepository {
  save(record: BackupRecord): Promise<void>;

  findById(id: string): Promise<BackupRecord | null>;

  /** The most recent backup for a target, of any status — used by
   *  `BackupPlanningService` to decide whether a full or incremental
   *  backup is due next. `null` when the target has never been backed up. */
  findLatestByTarget(target: BackupTarget): Promise<BackupRecord | null>;

  /** The most recent successfully completed (`COMPLETED`/`VERIFIED`)
   *  backup for a target — the current best restore candidate and RPO
   *  reference point. `null` when none exists yet. */
  findLatestCompletedByTarget(target: BackupTarget): Promise<BackupRecord | null>;

  /** Every backup for a target, newest first — used by
   *  `RetentionPolicyService` to decide what may be expired, and by
   *  status-reporting use cases. */
  listByTarget(target: BackupTarget): Promise<BackupRecord[]>;
}
