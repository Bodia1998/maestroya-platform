import type { BackupRecord, BackupTarget } from "@/domain/entities/backup";
import type { BackupRecordRepository } from "@/domain/repositories/backup-record-repository";

export interface BackupStatusReport {
  target: BackupTarget;
  latest: BackupRecord | null;
  latestCompleted: BackupRecord | null;
  history: BackupRecord[];
}

/**
 * Module 54 — Backup & Disaster Recovery.
 *
 * Read-only status query for one target — the entry point an admin
 * surface or `/api/health/ready`'s own backup check builds on. Performs
 * no mutation and never throws for "no backups yet" (returns `null`
 * fields), the same "a status read must never itself fail" contract every
 * other health/status read in this codebase follows.
 */
export class GetBackupStatusUseCase {
  constructor(private readonly repository: BackupRecordRepository) {}

  async execute(target: BackupTarget): Promise<BackupStatusReport> {
    const [latest, latestCompleted, history] = await Promise.all([
      this.repository.findLatestByTarget(target),
      this.repository.findLatestCompletedByTarget(target),
      this.repository.listByTarget(target),
    ]);

    return { target, latest, latestCompleted, history };
  }
}
