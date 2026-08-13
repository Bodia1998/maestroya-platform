import { describe, expect, it } from "vitest";

import { CapacityRecommendation, CapacityReport } from "@/domain/entities/capacity-report";
import { ValidationError } from "@/domain/errors/domain-error";

const t0 = new Date("2026-01-01T00:00:00.000Z");

describe("domain/entities/capacity-report — CapacityRecommendation", () => {
  it("rejects an empty description", () => {
    expect(() => new CapacityRecommendation("DATABASE_SCALING", "  ", "HIGH")).toThrow(ValidationError);
  });
});

describe("domain/entities/capacity-report — CapacityReport.build", () => {
  it("builds with a valid score", () => {
    const report = CapacityReport.build({
      id: "report-1",
      generatedAt: t0,
      projections: [],
      recommendations: [],
      bottlenecks: [],
      productionReadinessScore: 85,
    });
    expect(report.productionReadinessScore).toBe(85);
    expect(report.isProductionReady).toBe(true);
  });

  it("rejects a score outside 0..100", () => {
    expect(() =>
      CapacityReport.build({ id: "r", generatedAt: t0, projections: [], recommendations: [], bottlenecks: [], productionReadinessScore: 101 }),
    ).toThrow(ValidationError);
    expect(() =>
      CapacityReport.build({ id: "r", generatedAt: t0, projections: [], recommendations: [], bottlenecks: [], productionReadinessScore: -1 }),
    ).toThrow(ValidationError);
  });

  it("is not production ready below the score cut line even with zero bottlenecks", () => {
    const report = CapacityReport.build({
      id: "r",
      generatedAt: t0,
      projections: [],
      recommendations: [],
      bottlenecks: [],
      productionReadinessScore: 65,
    });
    expect(report.isProductionReady).toBe(false);
  });

  it("is not production ready when any bottleneck's error rate exceeds 5%, even with a high score", () => {
    const report = CapacityReport.build({
      id: "r",
      generatedAt: t0,
      projections: [],
      recommendations: [],
      bottlenecks: [{ scenarioId: "s1", scenarioName: "Scenario One", p95LatencyMs: 500, errorRate: 0.1, reason: "high error rate" }],
      productionReadinessScore: 90,
    });
    expect(report.isProductionReady).toBe(false);
  });
});
