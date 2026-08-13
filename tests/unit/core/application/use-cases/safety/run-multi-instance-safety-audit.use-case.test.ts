import { describe, expect, it } from "vitest";

import type { SafetyChecker, SubsystemCheckOutcome } from "@/application/ports/safety-checker";
import { AuditScoringService } from "@/application/services/safety/audit-scoring-service";
import { RunMultiInstanceSafetyAuditUseCase } from "@/application/use-cases/safety/run-multi-instance-safety-audit.use-case";

const t0 = new Date("2026-01-01T00:00:00.000Z");

function makeChecker(subsystem: string, outcome: SubsystemCheckOutcome): SafetyChecker {
  return { subsystem, check: async () => outcome };
}

function makeFailingChecker(subsystem: string, error: unknown): SafetyChecker {
  return {
    subsystem,
    check: async () => {
      throw error;
    },
  };
}

let counter = 0;
function makeUseCase(checkers: readonly SafetyChecker[]): RunMultiInstanceSafetyAuditUseCase {
  counter = 0;
  return new RunMultiInstanceSafetyAuditUseCase({
    checkers,
    scoring: new AuditScoringService(),
    generateId: () => `id-${++counter}`,
    now: () => t0,
  });
}

describe("application/use-cases/safety/run-multi-instance-safety-audit — RunMultiInstanceSafetyAuditUseCase", () => {
  it("builds a report from every checker's passed checks and findings", async () => {
    const checkers = [
      makeChecker("Locking", { passedChecks: ["lock check ok"], findings: [] }),
      makeChecker("Caching", {
        passedChecks: [],
        findings: [
          {
            severity: "WARNING",
            problem: "no redis",
            risk: "stale reads",
            whyItHappens: "no redis configured",
            impact: "inconsistency",
            recommendedFix: "configure redis",
            priority: "MEDIUM",
          },
        ],
      }),
    ];

    const useCase = makeUseCase(checkers);
    const report = await useCase.execute();

    expect(report.subsystems).toHaveLength(2);
    expect(report.subsystems[0]!.status).toBe("SAFE");
    expect(report.subsystems[1]!.status).toBe("WARNING");
    expect(report.allWarnings).toHaveLength(1);
    expect(report.overallScore).toBe(95);
    expect(report.generatedAt).toBe(t0);
  });

  it("assigns each finding a unique generated id and the checker's own subsystem name", async () => {
    const checkers = [
      makeChecker("Locking", {
        passedChecks: [],
        findings: [
          { severity: "CRITICAL", problem: "p", risk: "r", whyItHappens: "w", impact: "i", recommendedFix: "f", priority: "HIGH" },
        ],
      }),
    ];
    const useCase = makeUseCase(checkers);
    const report = await useCase.execute();

    const [finding] = report.subsystems[0]!.findings;
    expect(finding!.id).toBeTruthy();
    expect(finding!.subsystem).toBe("Locking");
  });

  it("converts a checker that throws into a single CRITICAL finding for that subsystem, without failing the whole audit", async () => {
    const checkers = [
      makeChecker("Locking", { passedChecks: ["ok"], findings: [] }),
      makeFailingChecker("Caching", new Error("boom")),
    ];
    const useCase = makeUseCase(checkers);
    const report = await useCase.execute();

    expect(report.subsystems).toHaveLength(2);
    const caching = report.subsystems.find((s) => s.subsystem === "Caching")!;
    expect(caching.status).toBe("CRITICAL");
    expect(caching.criticalIssues).toHaveLength(1);
    expect(caching.criticalIssues[0]!.problem).toContain("Caching");
  });

  it("runs every checker even when an earlier one throws", async () => {
    const checkers = [
      makeFailingChecker("First", new Error("fail")),
      makeChecker("Second", { passedChecks: ["ok"], findings: [] }),
    ];
    const useCase = makeUseCase(checkers);
    const report = await useCase.execute();

    expect(report.subsystems.map((s) => s.subsystem)).toEqual(["First", "Second"]);
    expect(report.subsystems[1]!.status).toBe("SAFE");
  });

  it("defaults a finding's evidence to an empty array when the checker omits it", async () => {
    const checkers = [
      makeChecker("Locking", {
        passedChecks: [],
        findings: [{ severity: "WARNING", problem: "p", risk: "r", whyItHappens: "w", impact: "i", recommendedFix: "f", priority: "LOW" }],
      }),
    ];
    const useCase = makeUseCase(checkers);
    const report = await useCase.execute();
    expect(report.subsystems[0]!.findings[0]!.evidence).toEqual([]);
  });
});
