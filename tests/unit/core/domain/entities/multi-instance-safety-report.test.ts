import { describe, expect, it } from "vitest";

import { AuditFinding } from "@/domain/entities/audit-finding";
import { MultiInstanceSafetyReport } from "@/domain/entities/multi-instance-safety-report";
import { SubsystemAuditResult } from "@/domain/entities/subsystem-audit-result";
import { ValidationError } from "@/domain/errors/domain-error";

const t0 = new Date("2026-01-01T00:00:00.000Z");

function safeSubsystem(name: string): SubsystemAuditResult {
  return SubsystemAuditResult.build(name, [`${name} check passed`], []);
}

function criticalSubsystem(name: string): SubsystemAuditResult {
  return SubsystemAuditResult.build(name, [], [
    new AuditFinding("f1", name, "CRITICAL", "problem", "risk", "why", "impact", "fix", "CRITICAL"),
  ]);
}

describe("domain/entities/multi-instance-safety-report — MultiInstanceSafetyReport.build", () => {
  it("builds with a valid score and at least one subsystem", () => {
    const report = MultiInstanceSafetyReport.build({
      id: "report-1",
      generatedAt: t0,
      subsystems: [safeSubsystem("Locking")],
      overallScore: 90,
      recommendedActions: [],
    });
    expect(report.overallScore).toBe(90);
    expect(report.isProductionReady).toBe(true);
    expect(report.totalPassedChecks).toBe(1);
  });

  it("rejects a score outside 0..100", () => {
    const subsystems = [safeSubsystem("Locking")];
    expect(() => MultiInstanceSafetyReport.build({ id: "r", generatedAt: t0, subsystems, overallScore: 101, recommendedActions: [] })).toThrow(ValidationError);
    expect(() => MultiInstanceSafetyReport.build({ id: "r", generatedAt: t0, subsystems, overallScore: -1, recommendedActions: [] })).toThrow(ValidationError);
  });

  it("rejects an empty subsystems list", () => {
    expect(() => MultiInstanceSafetyReport.build({ id: "r", generatedAt: t0, subsystems: [], overallScore: 100, recommendedActions: [] })).toThrow(ValidationError);
  });

  it("is not production ready below the score cut line even with zero critical subsystems", () => {
    const report = MultiInstanceSafetyReport.build({
      id: "r",
      generatedAt: t0,
      subsystems: [safeSubsystem("Locking")],
      overallScore: 65,
      recommendedActions: [],
    });
    expect(report.isProductionReady).toBe(false);
  });

  it("is not production ready when any subsystem is CRITICAL, even with a high score", () => {
    const report = MultiInstanceSafetyReport.build({
      id: "r",
      generatedAt: t0,
      subsystems: [safeSubsystem("Locking"), criticalSubsystem("Caching")],
      overallScore: 90,
      recommendedActions: [],
    });
    expect(report.isProductionReady).toBe(false);
  });

  it("aggregates warnings/critical issues/passed checks across subsystems", () => {
    const report = MultiInstanceSafetyReport.build({
      id: "r",
      generatedAt: t0,
      subsystems: [safeSubsystem("Locking"), criticalSubsystem("Caching")],
      overallScore: 50,
      recommendedActions: ["fix caching"],
    });
    expect(report.allCriticalIssues).toHaveLength(1);
    expect(report.allWarnings).toHaveLength(0);
    expect(report.totalPassedChecks).toBe(1);
    expect(report.recommendedActions).toEqual(["fix caching"]);
  });
});
