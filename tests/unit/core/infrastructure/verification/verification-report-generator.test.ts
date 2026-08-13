import { describe, expect, it } from "vitest";

import {
  buildVerificationReport,
  renderMarkdownVerificationReport,
  type VerificationReportData,
} from "@/infrastructure/verification/verification-report-generator";

function baseData(overrides: Partial<VerificationReportData> = {}): VerificationReportData {
  return {
    generatedAt: "2026-08-13T00:00:00.000Z",
    providers: [
      { name: "MANUAL", active: true, configured: true, notes: "always available" },
      { name: "PERSONA", active: false, configured: false, notes: "not configured" },
    ],
    statusDistribution: null,
    totalCases: null,
    syncableCases: null,
    security: [{ check: "a", passed: true, detail: "ok" }],
    architecture: [{ check: "b", passed: true, detail: "ok" }],
    integrationReadiness: [{ check: "c", passed: false, detail: "not wired up" }],
    ...overrides,
  };
}

describe("verification-report-generator (Module 59)", () => {
  it("is production-ready when every security/architecture check passes, even if integration-readiness items are still pending", () => {
    // baseData() has 1 passing security + 1 passing architecture + 1 failing
    // integrationReadiness item = 2/3 overall score, but isProductionReady
    // only looks at security+architecture (see buildVerificationReport's
    // own doc comment on why integration-readiness never counts against it).
    const report = buildVerificationReport(baseData());
    expect(report.productionReadinessScore).toBe(67);
    expect(report.isProductionReady).toBe(true);
  });

  it("scores 100 when every check across all three categories passes", () => {
    const report = buildVerificationReport(baseData({ integrationReadiness: [{ check: "c", passed: true, detail: "ok" }] }));
    expect(report.productionReadinessScore).toBe(100);
    expect(report.isProductionReady).toBe(true);
  });

  it("is not production-ready when a security or architecture check fails, but integration-readiness never counts against it", () => {
    const report = buildVerificationReport(
      baseData({ security: [{ check: "a", passed: false, detail: "broken" }] }),
    );
    expect(report.isProductionReady).toBe(false);
    expect(report.productionReadinessScore).toBeLessThan(100);
  });

  it("renders markdown with a data-unavailable note when statusDistribution is null", () => {
    const report = buildVerificationReport(baseData());
    const markdown = renderMarkdownVerificationReport(report);
    expect(markdown).toContain("Database was unreachable");
    expect(markdown).toContain("MaestroYa — Professional Verification Report (Module 59)");
  });

  it("renders the status distribution table when statistics are available", () => {
    const report = buildVerificationReport(
      baseData({
        statusDistribution: { DRAFT: 1, PENDING: 2, UNDER_REVIEW: 0, APPROVED: 3, REJECTED: 0, RESUBMISSION_REQUIRED: 0, EXPIRED: 0 },
        totalCases: 6,
        syncableCases: 2,
      }),
    );
    const markdown = renderMarkdownVerificationReport(report);
    expect(markdown).toContain("Total cases: 6");
    expect(markdown).toContain("Cases awaiting provider sync: 2");
  });
});
