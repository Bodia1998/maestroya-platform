import { describe, expect, it } from "vitest";

import { buildReferralReport, renderMarkdownReferralReport, type ReferralReportData } from "@/infrastructure/referral/referral-report-generator";
import type { ReferralStatistics } from "@/application/use-cases/referral/get-referral-statistics.use-case";

function statistics(overrides: Partial<ReferralStatistics> = {}): ReferralStatistics {
  return {
    totalVisits: 100,
    totalAttributedVisitors: 80,
    totalRegisteredVisitors: 20,
    topReferralCodes: [{ referralCode: "telegram_valencia", visits: 40 }],
    topCampaigns: [{ campaign: "spring_launch", visits: 30 }],
    registrations: 20,
    professionalRegistrations: 5,
    clientRegistrations: 15,
    bookingsCreated: 10,
    bookingsCompleted: 6,
    commissionsGenerated: 6,
    revenueAttributedTotal: 1234.56,
    visitToRegistrationRate: 0.2,
    registrationToBookingRate: 0.5,
    bookingCompletionRate: 0.6,
    ...overrides,
  };
}

function baseData(overrides: Partial<ReferralReportData> = {}): ReferralReportData {
  return {
    generatedAt: "2026-08-13T00:00:00.000Z",
    statistics: statistics(),
    architecture: [{ check: "a", passed: true, detail: "d" }],
    privacy: [{ check: "b", passed: true, detail: "d" }],
    integrationReadiness: [{ check: "c", passed: false, detail: "d" }],
    ...overrides,
  };
}

describe("Module 60 — referral-report-generator", () => {
  it("scores 100 when every architecture/privacy/integration check passes", () => {
    const data = baseData({ integrationReadiness: [{ check: "c", passed: true, detail: "d" }] });
    const report = buildReferralReport(data);
    expect(report.productionReadinessScore).toBe(100);
    expect(report.isProductionReady).toBe(true);
  });

  it("is production-ready when only integration-readiness checks fail (informational only)", () => {
    const report = buildReferralReport(baseData());
    expect(report.isProductionReady).toBe(true);
    expect(report.productionReadinessScore).toBeLessThan(100);
  });

  it("is not production-ready when an architecture or privacy check fails", () => {
    const report = buildReferralReport(baseData({ architecture: [{ check: "a", passed: false, detail: "d" }] }));
    expect(report.isProductionReady).toBe(false);
  });

  it("renders markdown with the statistics section populated", () => {
    const report = buildReferralReport(baseData());
    const markdown = renderMarkdownReferralReport(report);
    expect(markdown).toContain("Module 60");
    expect(markdown).toContain("telegram_valencia");
    expect(markdown).toContain("spring_launch");
    expect(markdown).toContain("Total visits: 100");
  });

  it("renders a graceful unavailable message when statistics is null", () => {
    const report = buildReferralReport(baseData({ statistics: null }));
    const markdown = renderMarkdownReferralReport(report);
    expect(markdown).toContain("unavailable");
  });
});
