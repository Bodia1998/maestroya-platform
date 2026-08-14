import { describe, expect, it } from "vitest";

import {
  buildOnboardingReport,
  renderMarkdownOnboardingReport,
  type OnboardingReportData,
} from "@/infrastructure/onboarding/onboarding-report-generator";

function baseData(overrides: Partial<OnboardingReportData> = {}): OnboardingReportData {
  return {
    generatedAt: "2026-08-14T00:00:00.000Z",
    inProgressCount: null,
    activatedCount: null,
    architecture: [{ check: "a", passed: true, detail: "ok" }],
    activationRules: [{ check: "b", passed: true, detail: "ok" }],
    providerAbstraction: [{ check: "c", passed: true, detail: "ok" }],
    verificationIntegration: [{ check: "d", passed: true, detail: "ok" }],
    stripeReadiness: [{ check: "e", passed: false, detail: "not wired up" }],
    onboardingCompleteness: [{ check: "f", passed: true, detail: "ok" }],
    ...overrides,
  };
}

describe("onboarding-report-generator (Module 62)", () => {
  it("is production-ready when every check except stripeReadiness passes", () => {
    const report = buildOnboardingReport(baseData());
    expect(report.isProductionReady).toBe(true);
    expect(report.productionReadinessScore).toBeLessThan(100);
  });

  it("scores 100 when every check across all categories passes", () => {
    const report = buildOnboardingReport(
      baseData({ stripeReadiness: [{ check: "e", passed: true, detail: "ok" }] }),
    );
    expect(report.productionReadinessScore).toBe(100);
    expect(report.isProductionReady).toBe(true);
  });

  it("is not production-ready when an architecture or activation-rule check fails", () => {
    const report = buildOnboardingReport(baseData({ architecture: [{ check: "a", passed: false, detail: "broken" }] }));
    expect(report.isProductionReady).toBe(false);
  });

  it("renders a data-unavailable note in markdown when counts are null", () => {
    const report = buildOnboardingReport(baseData());
    const markdown = renderMarkdownOnboardingReport(report);
    expect(markdown).toContain("Database was unreachable");
    expect(markdown).toContain("MaestroYa — Professional Onboarding Report (Module 62)");
  });

  it("renders onboarding statistics when counts are available", () => {
    const report = buildOnboardingReport(baseData({ inProgressCount: 4, activatedCount: 10 }));
    const markdown = renderMarkdownOnboardingReport(report);
    expect(markdown).toContain("In progress: 4");
    expect(markdown).toContain("Activated: 10");
  });
});
