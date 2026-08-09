import { describe, expect, it } from "vitest";

import { RetentionPolicyService } from "@/application/services/backup/retention-policy-service";
import { BackupRecord, RetentionPolicy } from "@/domain/entities/backup";

function completedBackup(id: string, completedAt: Date, policy: RetentionPolicy): BackupRecord {
  const record = BackupRecord.schedule(id, "DATABASE", "FULL", policy, completedAt);
  record.markRunning(completedAt);
  record.markCompleted({ sizeBytes: 1, checksumSha256: "a".repeat(64), locationUri: `/tmp/${id}` }, completedAt);
  return record;
}

describe("application/services/backup/retention-policy-service", () => {
  const service = new RetentionPolicyService();
  const now = new Date("2026-06-01T00:00:00.000Z");

  it("returns nothing when there are no backups", () => {
    expect(service.selectExpired([], now)).toEqual([]);
  });

  it("never expires backups within the retentionDays window", () => {
    const policy = new RetentionPolicy(30, 1);
    const backup = completedBackup("recent", new Date("2026-05-20T00:00:00.000Z"), policy);
    expect(service.selectExpired([backup], now)).toEqual([]);
  });

  it("expires a backup past its retentionDays window when above the minRetainedBackups floor", () => {
    const policy = new RetentionPolicy(10, 1);
    const old1 = completedBackup("old1", new Date("2026-01-01T00:00:00.000Z"), policy);
    const recent = completedBackup("recent", new Date("2026-05-30T00:00:00.000Z"), policy);
    const expired = service.selectExpired([old1, recent], now);
    expect(expired.map((backup) => backup.id)).toEqual(["old1"]);
  });

  it("never drops below minRetainedBackups even if every backup is expired by age", () => {
    const policy = new RetentionPolicy(1, 2);
    const oldest = completedBackup("oldest", new Date("2026-01-01T00:00:00.000Z"), policy);
    const older = completedBackup("older", new Date("2026-01-05T00:00:00.000Z"), policy);
    const old = completedBackup("old", new Date("2026-01-10T00:00:00.000Z"), policy);

    const expired = service.selectExpired([oldest, older, old], now);
    // Only the single oldest beyond the floor of 2 retained is expired.
    expect(expired.map((backup) => backup.id)).toEqual(["oldest"]);
  });

  it("ignores FAILED backups entirely (nothing to expire)", () => {
    const policy = new RetentionPolicy(1, 1);
    const failed = BackupRecord.schedule("failed1", "DATABASE", "FULL", policy, new Date("2026-01-01T00:00:00.000Z"));
    failed.markFailed("boom", new Date("2026-01-01T00:00:00.000Z"));

    expect(service.selectExpired([failed], now)).toEqual([]);
  });

  it("does not re-select an already-EXPIRED backup", () => {
    const policy = new RetentionPolicy(1, 1);
    const backup = completedBackup("already-expired", new Date("2026-01-01T00:00:00.000Z"), policy);
    backup.markExpired(now);
    expect(service.selectExpired([backup], now)).toEqual([]);
  });
});
