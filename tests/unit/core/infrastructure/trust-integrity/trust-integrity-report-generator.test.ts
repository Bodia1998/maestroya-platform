import { describe, expect, it } from "vitest";

import {
  buildTrustIntegrityReport,
  renderMarkdownTrustIntegrityReport,
  type TrustIntegrityReportData,
  type TrustIntegritySummaryStatistics,
} from "@/infrastructure/trust-integrity/trust-integrity-report-generator";

function statistics(overrides: Partial<TrustIntegritySummaryStatistics> = {}): TrustIntegritySummaryStatistics {
  return {
    totalTrustProfiles: 100,
    usersAtOrAboveWarningRisk: 10,
    usersAtOrAboveSuspensionRisk: 2,
    usersWithLowTrust: 5,
    openFraudSignals: 3,
    totalFraudSignals: 20,
    offPlatformDetectionEventsTotal: 40,
    activeAutomatedActions: 4,
    totalAutomatedActions: 30,
    openManualReviewCases: 2,
    totalManualReviewCases: 15,
    pendingAppeals: 1,
    totalAppeals: 6,
    ...overrides,
  };
}

function baseData(overrides: Partial<TrustIntegrityReportData> = {}): TrustIntegrityReportData {
  return {
    generatedAt: "2026-08-14T00:00:00.000Z",
    statistics: statistics(),
    architectureValidation: [{ check: "a", passed: true, detail: "d" }],
    businessRulesValidation: [{ check: "b", passed: true, detail: "d" }],
    fraudDetectionCoverage: [{ check: "c", passed: true, detail: "d" }],
    riskEngineValidation: [{ check: "d", passed: true, detail: "d" }],
    trustScoreValidation: [{ check: "e", passed: true, detail: "d" }],
    futureIntegrationReadiness: [{ check: "f", passed: true, detail: "d" }],
    ...overrides,
  };
}

describe("Module 65 — trust-integrity-report-generator", () => {
  it("scores 100 and is production ready when every check passes", () => {
    const report = buildTrustIntegrityReport(baseData());
    expect(report.productionReadinessScore).toBe(100);
    expect(report.isProductionReady).toBe(true);
  });

  it("is not production ready when any single check fails", () => {
    const report = buildTrustIntegrityReport(
      baseData({ riskEngineValidation: [{ check: "d", passed: false, detail: "broken" }] }),
    );
    expect(report.isProductionReady).toBe(false);
    expect(report.productionReadinessScore).toBeLessThan(100);
  });

  it("computes score as the fraction of passed checks across all six categories", () => {
    const report = buildTrustIntegrityReport(
      baseData({
        architectureValidation: [
          { check: "a1", passed: true, detail: "d" },
          { check: "a2", passed: false, detail: "d" },
        ],
      }),
    );
    // 6 of 7 total checks pass (5 categories with 1 passing check each, plus
    // architecture's 2 checks with 1 passing) -> round(6/7*100)
    expect(report.productionReadinessScore).toBe(Math.round((6 / 7) * 100));
  });

  it("scores 0 with no checks at all", () => {
    const report = buildTrustIntegrityReport(
      baseData({
        architectureValidation: [],
        businessRulesValidation: [],
        fraudDetectionCoverage: [],
        riskEngineValidation: [],
        trustScoreValidation: [],
        futureIntegrationReadiness: [],
      }),
    );
    expect(report.productionReadinessScore).toBe(0);
    // every() on an empty array is vacuously true, matching PricingReport's own convention.
    expect(report.isProductionReady).toBe(true);
  });

  it("renders markdown with the module title, score, and every section header", () => {
    const report = buildTrustIntegrityReport(baseData());
    const markdown = renderMarkdownTrustIntegrityReport(report);
    expect(markdown).toContain("Module 65");
    expect(markdown).toContain("Overall Readiness Score: 100 / 100");
    expect(markdown).toContain("## Architecture Validation");
    expect(markdown).toContain("## Business Rules Validation");
    expect(markdown).toContain("## Fraud Detection Coverage");
    expect(markdown).toContain("## Risk Engine Validation");
    expect(markdown).toContain("## Trust Score Validation");
    expect(markdown).toContain("## Future Integration Readiness");
  });

  it("renders a fallback message when statistics is null (database unreachable)", () => {
    const report = buildTrustIntegrityReport(baseData({ statistics: null }));
    const markdown = renderMarkdownTrustIntegrityReport(report);
    expect(markdown).toContain("Database was unreachable");
  });

  it("renders the statistics values when present", () => {
    const report = buildTrustIntegrityReport(baseData());
    const markdown = renderMarkdownTrustIntegrityReport(report);
    expect(markdown).toContain("Total trust profiles: 100");
    expect(markdown).toContain("Open fraud signals: 3 (of 20 total)");
  });
});
