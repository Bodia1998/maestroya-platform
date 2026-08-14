import { describe, expect, it } from "vitest";

import {
  buildMaterialsReport,
  renderMarkdownMaterialsReport,
  type MaterialsReportData,
} from "@/infrastructure/materials/materials-report-generator";
import type { MaterialsStatistics } from "@/application/use-cases/materials/get-materials-statistics.use-case";

function statistics(overrides: Partial<MaterialsStatistics> = {}): MaterialsStatistics {
  return {
    totalQuotes: 100,
    professionalSuppliedQuotes: 80,
    customerPurchasedQuotes: 20,
    customerPurchasedConfirmed: 12,
    customerPurchasedAwaitingConfirmation: 8,
    totalMaterialsListed: 55,
    ...overrides,
  };
}

function baseData(overrides: Partial<MaterialsReportData> = {}): MaterialsReportData {
  return {
    generatedAt: "2026-08-14T00:00:00.000Z",
    statistics: statistics(),
    architecture: [{ check: "a", passed: true, detail: "d" }],
    businessRules: [{ check: "b", passed: true, detail: "d" }],
    integrationReadiness: [{ check: "c", passed: false, detail: "d" }],
    ...overrides,
  };
}

describe("Module 63 — materials-report-generator", () => {
  it("scores 100 when every architecture/businessRules/integration check passes", () => {
    const data = baseData({ integrationReadiness: [{ check: "c", passed: true, detail: "d" }] });
    const report = buildMaterialsReport(data);
    expect(report.productionReadinessScore).toBe(100);
    expect(report.isProductionReady).toBe(true);
  });

  it("is production-ready when only integration-readiness checks fail (informational only)", () => {
    const report = buildMaterialsReport(baseData());
    expect(report.isProductionReady).toBe(true);
    expect(report.productionReadinessScore).toBeLessThan(100);
  });

  it("is not production-ready when an architecture check fails", () => {
    const report = buildMaterialsReport(baseData({ architecture: [{ check: "a", passed: false, detail: "d" }] }));
    expect(report.isProductionReady).toBe(false);
  });

  it("is not production-ready when a business rule check fails", () => {
    const report = buildMaterialsReport(baseData({ businessRules: [{ check: "b", passed: false, detail: "d" }] }));
    expect(report.isProductionReady).toBe(false);
  });

  it("scores 0 when no checks are supplied at all", () => {
    const report = buildMaterialsReport(baseData({ architecture: [], businessRules: [], integrationReadiness: [] }));
    expect(report.productionReadinessScore).toBe(0);
  });

  it("renders markdown with the statistics section populated", () => {
    const report = buildMaterialsReport(baseData());
    const markdown = renderMarkdownMaterialsReport(report);
    expect(markdown).toContain("Module 63");
    expect(markdown).toContain("Total quotes: 100");
    expect(markdown).toContain("Customer-purchased: 20");
  });

  it("renders a fallback message when statistics is null (database unreachable)", () => {
    const report = buildMaterialsReport(baseData({ statistics: null }));
    const markdown = renderMarkdownMaterialsReport(report);
    expect(markdown).toContain("Database was unreachable");
    expect(markdown).not.toContain("Total quotes:");
  });

  it("includes every check's PASS/FAIL result in the rendered tables", () => {
    const report = buildMaterialsReport(baseData());
    const markdown = renderMarkdownMaterialsReport(report);
    expect(markdown).toContain("PASS");
    expect(markdown).toContain("FAIL");
  });
});
