import { describe, expect, it } from "vitest";

import {
  buildAffiliateReport,
  renderMarkdownAffiliateReport,
  type AffiliateReportData,
  type AffiliateSummaryStatistics,
} from "@/infrastructure/affiliate/affiliate-report-generator";

function statistics(overrides: Partial<AffiliateSummaryStatistics> = {}): AffiliateSummaryStatistics {
  return {
    totalPartners: 10,
    pendingPartners: 2,
    approvedPartners: 6,
    suspendedPartners: 1,
    bannedPartners: 1,
    rejectedPartners: 0,
    totalAffiliateCommissions: 40,
    pendingCommissionTotal: 120.5,
    approvedCommissionTotal: 300,
    paidCommissionTotal: 1000,
    totalPlatformCommissionGenerated: 14205,
    openFraudFlags: 3,
    ...overrides,
  };
}

function baseData(overrides: Partial<AffiliateReportData> = {}): AffiliateReportData {
  return {
    generatedAt: "2026-08-13T00:00:00.000Z",
    statistics: statistics(),
    architecture: [{ check: "a", passed: true, detail: "d" }],
    commissionPolicy: [{ check: "b", passed: true, detail: "d" }],
    integrationReadiness: [{ check: "c", passed: false, detail: "d" }],
    ...overrides,
  };
}

describe("Module 61 — affiliate-report-generator", () => {
  it("scores 100 when every architecture/commission-policy/integration check passes", () => {
    const data = baseData({ integrationReadiness: [{ check: "c", passed: true, detail: "d" }] });
    const report = buildAffiliateReport(data);
    expect(report.productionReadinessScore).toBe(100);
    expect(report.isProductionReady).toBe(true);
  });

  it("is production-ready when only integration-readiness checks fail (informational only)", () => {
    const report = buildAffiliateReport(baseData());
    expect(report.isProductionReady).toBe(true);
    expect(report.productionReadinessScore).toBeLessThan(100);
  });

  it("is not production-ready when a commission-policy check fails", () => {
    const report = buildAffiliateReport(baseData({ commissionPolicy: [{ check: "b", passed: false, detail: "d" }] }));
    expect(report.isProductionReady).toBe(false);
  });

  it("is not production-ready when an architecture check fails", () => {
    const report = buildAffiliateReport(baseData({ architecture: [{ check: "a", passed: false, detail: "d" }] }));
    expect(report.isProductionReady).toBe(false);
  });

  it("renders markdown with the statistics section populated", () => {
    const report = buildAffiliateReport(baseData());
    const markdown = renderMarkdownAffiliateReport(report);
    expect(markdown).toContain("Module 61");
    expect(markdown).toContain("Total partners: 10");
    expect(markdown).toContain("Open fraud flags awaiting admin review: 3");
  });

  it("renders a graceful unavailable message when statistics is null", () => {
    const report = buildAffiliateReport(baseData({ statistics: null }));
    const markdown = renderMarkdownAffiliateReport(report);
    expect(markdown).toContain("unavailable");
  });
});
