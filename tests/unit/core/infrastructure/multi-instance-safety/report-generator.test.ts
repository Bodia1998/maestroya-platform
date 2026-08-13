import { describe, expect, it } from "vitest";

import { AuditFinding } from "@/domain/entities/audit-finding";
import { MultiInstanceSafetyReport } from "@/domain/entities/multi-instance-safety-report";
import { SubsystemAuditResult } from "@/domain/entities/subsystem-audit-result";
import { buildStructuredReport, readinessStatusFor, renderMarkdownReport, toJsonReport } from "@/infrastructure/multi-instance-safety/report-generator";

const t0 = new Date("2026-01-01T00:00:00.000Z");

function makeReport(): MultiInstanceSafetyReport {
  const critical = new AuditFinding("f1", "Caching", "CRITICAL", "No Redis-first factory.", "Stale reads.", "In-memory fallback used.", "Bad UX.", "Configure Redis.", "CRITICAL", ["src/cache.ts"]);
  const warning = new AuditFinding("f2", "Locking", "WARNING", "In-memory fallback reachable.", "Lost mutual exclusion.", "REDIS_URL unset.", "Race conditions.", "Assert REDIS_URL at startup.", "MEDIUM");

  return MultiInstanceSafetyReport.build({
    id: "report-1",
    generatedAt: t0,
    subsystems: [
      SubsystemAuditResult.build("Caching", ["cache TTL required"], [critical]),
      SubsystemAuditResult.build("Locking", ["atomic NX acquisition"], [warning]),
      SubsystemAuditResult.build("Auth", ["jwt sessions"], []),
    ],
    overallScore: 60,
    recommendedActions: ["[Caching] Configure Redis.", "[Locking] Assert REDIS_URL at startup."],
  });
}

describe("infrastructure/multi-instance-safety/report-generator — readinessStatusFor", () => {
  it("returns Green at or above 90", () => {
    expect(readinessStatusFor(90)).toBe("Green");
    expect(readinessStatusFor(100)).toBe("Green");
  });

  it("returns Yellow between 70 and 89", () => {
    expect(readinessStatusFor(70)).toBe("Yellow");
    expect(readinessStatusFor(89)).toBe("Yellow");
  });

  it("returns Red below 70", () => {
    expect(readinessStatusFor(69)).toBe("Red");
    expect(readinessStatusFor(0)).toBe("Red");
  });
});

describe("infrastructure/multi-instance-safety/report-generator — buildStructuredReport", () => {
  it("computes risk classification counts per subsystem status", () => {
    const structured = buildStructuredReport(makeReport());
    expect(structured.riskClassification).toEqual({ SAFE: 1, WARNING: 1, CRITICAL: 1 });
  });

  it("separates warnings from critical issues", () => {
    const structured = buildStructuredReport(makeReport());
    expect(structured.warnings).toHaveLength(1);
    expect(structured.criticalIssues).toHaveLength(1);
    expect(structured.criticalIssues[0]!.subsystem).toBe("Caching");
  });

  it("flattens passed checks across every subsystem", () => {
    const structured = buildStructuredReport(makeReport());
    expect(structured.passedChecks).toEqual(["cache TTL required", "atomic NX acquisition", "jwt sessions"]);
  });

  it("reflects the report's own productionReady/overallScore", () => {
    const report = makeReport();
    const structured = buildStructuredReport(report);
    expect(structured.overallScore).toBe(60);
    expect(structured.productionReady).toBe(report.isProductionReady);
  });
});

describe("infrastructure/multi-instance-safety/report-generator — renderMarkdownReport", () => {
  it("renders the score, verdict, subsystem list, findings, and recommended actions", () => {
    const markdown = renderMarkdownReport(makeReport());

    expect(markdown).toContain("# MaestroYa Multi-Instance Safety Audit");
    expect(markdown).toContain("Overall Score: 60 / 100");
    expect(markdown).toContain("## Critical Issues");
    expect(markdown).toContain("No Redis-first factory.");
    expect(markdown).toContain("## Warnings");
    expect(markdown).toContain("In-memory fallback reachable.");
    expect(markdown).toContain("## Passed Checks");
    expect(markdown).toContain("jwt sessions");
    expect(markdown).toContain("## Recommended Actions");
    expect(markdown).toContain("Configure Redis.");
  });

  it("renders 'None identified.' when there are no critical issues", () => {
    const safeReport = MultiInstanceSafetyReport.build({
      id: "r",
      generatedAt: t0,
      subsystems: [SubsystemAuditResult.build("Auth", ["ok"], [])],
      overallScore: 100,
      recommendedActions: [],
    });
    const markdown = renderMarkdownReport(safeReport);
    expect(markdown).toContain("## Critical Issues\n\nNone identified.");
    expect(markdown).toContain("No further action needed.");
  });
});

describe("infrastructure/multi-instance-safety/report-generator — toJsonReport", () => {
  it("returns the same shape as buildStructuredReport", () => {
    const report = makeReport();
    expect(toJsonReport(report)).toEqual(buildStructuredReport(report));
  });
});
