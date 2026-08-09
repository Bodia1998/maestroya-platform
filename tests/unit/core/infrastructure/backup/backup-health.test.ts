import { describe, expect, it } from "vitest";

import { collectBackupHealth, DISABLED_BACKUP_HEALTH } from "@/infrastructure/backup/backup-health";
import { BackupRecord, RetentionPolicy } from "@/domain/entities/backup";

const policy = new RetentionPolicy(30, 3);

function completedAt(date: Date): BackupRecord {
  const record = BackupRecord.schedule("id", "DATABASE", "FULL", policy, date);
  record.markRunning(date);
  record.markCompleted({ sizeBytes: 1, checksumSha256: "a".repeat(64), locationUri: "/tmp/x" }, date);
  return record;
}

describe("infrastructure/backup/backup-health", () => {
  const now = new Date("2026-06-10T00:00:00.000Z");

  it("DISABLED_BACKUP_HEALTH is the disabled sentinel", () => {
    expect(DISABLED_BACKUP_HEALTH.status).toBe("disabled");
  });

  it("reports degraded with an issue when a target has never backed up", () => {
    const report = collectBackupHealth([{ target: "DATABASE", latest: null, latestCompleted: null }], null, now);
    expect(report.status).toBe("degraded");
    expect(report.issues[0]).toContain("no completed backup");
  });

  it("reports ok when the freshest completed backup is within the age threshold", () => {
    const backup = completedAt(new Date("2026-06-09T00:00:00.000Z"));
    const report = collectBackupHealth([{ target: "DATABASE", latest: backup, latestCompleted: backup }], null, now);
    expect(report.status).toBe("ok");
  });

  it("reports degraded when the freshest completed backup exceeds the age threshold", () => {
    const backup = completedAt(new Date("2026-06-01T00:00:00.000Z"));
    const report = collectBackupHealth([{ target: "DATABASE", latest: backup, latestCompleted: backup }], null, now);
    expect(report.status).toBe("degraded");
  });

  it("reports the most recent FAILED backup as an issue even if an older successful one exists", () => {
    const failed = BackupRecord.schedule("f1", "DATABASE", "FULL", policy, now);
    failed.markFailed("pg_dump failed", now);
    const report = collectBackupHealth([{ target: "DATABASE", latest: failed, latestCompleted: null }], null, now);
    expect(report.issues.some((issue) => issue.includes("FAILED"))).toBe(true);
  });

  it("never throws for any combination of inputs", () => {
    expect(() => collectBackupHealth([], null, now)).not.toThrow();
  });
});
