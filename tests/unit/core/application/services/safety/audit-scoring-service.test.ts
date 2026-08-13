import { describe, expect, it } from "vitest";

import { AuditScoringService } from "@/application/services/safety/audit-scoring-service";
import { AuditFinding } from "@/domain/entities/audit-finding";
import { SubsystemAuditResult } from "@/domain/entities/subsystem-audit-result";

function finding(subsystem: string, severity: "WARNING" | "CRITICAL", priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL", id = "f1"): AuditFinding {
  return new AuditFinding(id, subsystem, severity, `problem-${id}`, "risk", "why", "impact", `fix-${id}`, priority);
}

describe("application/services/safety/audit-scoring-service — AuditScoringService", () => {
  it("returns 100 when there are no findings at all", () => {
    const service = new AuditScoringService();
    const subsystems = [SubsystemAuditResult.build("Locking", ["ok"], [])];
    expect(service.computeOverallScore(subsystems)).toBe(100);
  });

  it("deducts a flat penalty per warning", () => {
    const service = new AuditScoringService();
    const subsystems = [SubsystemAuditResult.build("Locking", [], [finding("Locking", "WARNING", "LOW")])];
    expect(service.computeOverallScore(subsystems)).toBe(95);
  });

  it("deducts a priority-weighted penalty per critical finding", () => {
    const service = new AuditScoringService();
    const subsystems = [SubsystemAuditResult.build("Locking", [], [finding("Locking", "CRITICAL", "CRITICAL")])];
    expect(service.computeOverallScore(subsystems)).toBe(75);
  });

  it("clamps the score at 0 rather than going negative", () => {
    const service = new AuditScoringService();
    const manyFindings = Array.from({ length: 10 }, (_, i) => finding("Locking", "CRITICAL", "CRITICAL", `f${i}`));
    const subsystems = [SubsystemAuditResult.build("Locking", [], manyFindings)];
    expect(service.computeOverallScore(subsystems)).toBe(0);
  });

  it("sums penalties across multiple subsystems", () => {
    const service = new AuditScoringService();
    const subsystems = [
      SubsystemAuditResult.build("Locking", [], [finding("Locking", "WARNING", "LOW")]),
      SubsystemAuditResult.build("Caching", [], [finding("Caching", "CRITICAL", "MEDIUM")]),
    ];
    expect(service.computeOverallScore(subsystems)).toBe(100 - 5 - 12);
  });

  it("ranks recommended actions critical-first, then by priority, and caps the list", () => {
    const service = new AuditScoringService();
    const subsystems = [
      SubsystemAuditResult.build("Locking", [], [finding("Locking", "WARNING", "LOW", "w1")]),
      SubsystemAuditResult.build("Caching", [], [finding("Caching", "CRITICAL", "HIGH", "c1")]),
    ];
    const actions = service.buildRecommendedActions(subsystems);
    expect(actions[0]).toContain("Caching");
    expect(actions[1]).toContain("Locking");
  });

  it("deduplicates identical recommended actions across subsystems", () => {
    const service = new AuditScoringService();
    const identical1 = new AuditFinding("f1", "Locking", "WARNING", "p1", "r", "w", "i", "Use Redis.", "LOW");
    const identical2 = new AuditFinding("f2", "Locking", "WARNING", "p2", "r", "w", "i", "Use Redis.", "LOW");
    const subsystems = [SubsystemAuditResult.build("Locking", [], [identical1, identical2])];
    const actions = service.buildRecommendedActions(subsystems);
    expect(actions).toHaveLength(1);
  });

  it("returns an empty recommended-actions list when there are no findings", () => {
    const service = new AuditScoringService();
    const subsystems = [SubsystemAuditResult.build("Locking", ["ok"], [])];
    expect(service.buildRecommendedActions(subsystems)).toEqual([]);
  });
});
