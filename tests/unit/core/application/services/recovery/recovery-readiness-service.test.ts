import { describe, expect, it } from "vitest";

import { RecoveryReadinessService } from "@/application/services/recovery/recovery-readiness-service";
import { BackupRecord, RetentionPolicy } from "@/domain/entities/backup";
import { RecoveryExecution } from "@/domain/entities/disaster-recovery";
import type { DisasterRecoveryPlan } from "@/domain/entities/disaster-recovery";

const plan: DisasterRecoveryPlan = {
  id: "plan-1",
  name: "Test plan",
  description: "...",
  rtoMinutes: 60,
  rpoMinutes: 1440, // 24 hours
  steps: [],
};

const policy = new RetentionPolicy(30, 3);

function completedBackupAt(completedAt: Date): BackupRecord {
  const record = BackupRecord.schedule("b1", "DATABASE", "FULL", policy, completedAt);
  record.markRunning(completedAt);
  record.markCompleted({ sizeBytes: 1, checksumSha256: "a".repeat(64), locationUri: "/tmp/x" }, completedAt);
  return record;
}

function completedDrillAt(completedAt: Date): RecoveryExecution {
  const execution = RecoveryExecution.start("e1", plan.id, "scheduled drill", true, completedAt);
  execution.begin();
  execution.complete(completedAt);
  return execution;
}

describe("application/services/recovery/recovery-readiness-service", () => {
  const service = new RecoveryReadinessService();
  const now = new Date("2026-06-10T00:00:00.000Z");

  it("reports not_ready when a plan has no completed backup at all", () => {
    const report = service.evaluate([{ plan, target: "DATABASE", latestCompletedBackup: null, lastSuccessfulDrill: null }], now);
    expect(report.status).toBe("not_ready");
    expect(report.plans.at(0)?.rpoSatisfied).toBeNull();
  });

  it("reports not_ready when the freshest backup exceeds the plan's RPO", () => {
    const stale = completedBackupAt(new Date("2026-06-01T00:00:00.000Z")); // 9 days old, RPO is 1 day
    const report = service.evaluate([{ plan, target: "DATABASE", latestCompletedBackup: stale, lastSuccessfulDrill: null }], now);
    expect(report.status).toBe("not_ready");
    expect(report.plans.at(0)?.rpoSatisfied).toBe(false);
  });

  it("reports at_risk when RPO is satisfied but the plan has never been drilled", () => {
    const fresh = completedBackupAt(new Date("2026-06-09T12:00:00.000Z"));
    const report = service.evaluate([{ plan, target: "DATABASE", latestCompletedBackup: fresh, lastSuccessfulDrill: null }], now);
    expect(report.status).toBe("at_risk");
    expect(report.plans.at(0)?.rpoSatisfied).toBe(true);
  });

  it("reports ready when RPO is satisfied and a recent drill succeeded", () => {
    const fresh = completedBackupAt(new Date("2026-06-09T12:00:00.000Z"));
    const drill = completedDrillAt(new Date("2026-06-01T00:00:00.000Z"));
    const report = service.evaluate([{ plan, target: "DATABASE", latestCompletedBackup: fresh, lastSuccessfulDrill: drill }], now);
    expect(report.status).toBe("ready");
    expect(report.issues).toEqual([]);
  });

  it("reports at_risk when the last successful drill is older than the readiness window", () => {
    const fresh = completedBackupAt(new Date("2026-06-09T12:00:00.000Z"));
    const oldDrill = completedDrillAt(new Date("2026-01-01T00:00:00.000Z"));
    const report = service.evaluate([{ plan, target: "DATABASE", latestCompletedBackup: fresh, lastSuccessfulDrill: oldDrill }], now);
    expect(report.status).toBe("at_risk");
  });

  it("never throws for any combination of inputs", () => {
    expect(() => service.evaluate([], now)).not.toThrow();
  });
});
