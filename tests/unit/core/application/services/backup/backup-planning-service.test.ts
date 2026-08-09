import { describe, expect, it } from "vitest";

import { BackupPlanningService } from "@/application/services/backup/backup-planning-service";
import { BackupRecord, RetentionPolicy } from "@/domain/entities/backup";

const policy = new RetentionPolicy(30, 3);
const schedulePolicy = { fullBackupIntervalDays: 7 };

function completed(type: "FULL" | "INCREMENTAL", completedAt: Date): BackupRecord {
  const record = BackupRecord.schedule("id", "DATABASE", type, policy, completedAt);
  record.markRunning(completedAt);
  record.markCompleted({ sizeBytes: 1, checksumSha256: "a".repeat(64), locationUri: "/tmp/x" }, completedAt);
  return record;
}

describe("application/services/backup/backup-planning-service", () => {
  const service = new BackupPlanningService();
  const now = new Date("2026-06-10T00:00:00.000Z");

  it("chooses FULL when there is no prior successful backup", () => {
    expect(service.decideNextBackupType(null, schedulePolicy, now)).toBe("FULL");
  });

  it("chooses INCREMENTAL when the latest FULL backup is still within the interval", () => {
    const latest = completed("FULL", new Date("2026-06-08T00:00:00.000Z"));
    expect(service.decideNextBackupType(latest, schedulePolicy, now)).toBe("INCREMENTAL");
  });

  it("chooses FULL when the latest FULL backup is older than the interval", () => {
    const latest = completed("FULL", new Date("2026-05-01T00:00:00.000Z"));
    expect(service.decideNextBackupType(latest, schedulePolicy, now)).toBe("FULL");
  });

  it("chooses FULL again immediately after an INCREMENTAL (never chains two incrementals)", () => {
    const latest = completed("INCREMENTAL", new Date("2026-06-09T00:00:00.000Z"));
    expect(service.decideNextBackupType(latest, schedulePolicy, now)).toBe("FULL");
  });
});
