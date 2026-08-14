/**
 * Module 64 — Pricing & Commission Engine: pure data -> markdown/JSON
 * rendering for `npm run pricing-report`, split out of
 * `scripts/run-pricing-report.ts` — same "the script gathers data
 * (possibly unavailable), this file only knows how to render whatever it
 * was handed" convention `infrastructure/affiliate/affiliate-report-
 * generator.ts` establishes for Module 61.
 */
export interface CheckResult {
  check: string;
  passed: boolean;
  detail: string;
}

export interface PricingSummaryStatistics {
  grossLaborVolume: number;
  grossMaterialsVolume: number;
  professionalCommissions: number;
  platformGrossRevenue: number;
  payoutsTotal: number;
  paymentCount: number;
}

export interface PricingReportData {
  generatedAt: string;
  /** `null` when the database could not be reached — same convention
   *  `AffiliateReportData.statistics` documents. */
  statistics: PricingSummaryStatistics | null;
  architecture: CheckResult[];
  businessRules: CheckResult[];
  moneyAndRounding: CheckResult[];
  singleSourceOfTruth: CheckResult[];
  futureExtensibility: CheckResult[];
}

export interface PricingReport extends PricingReportData {
  productionReadinessScore: number;
  isProductionReady: boolean;
}

function computeScore(data: PricingReportData): number {
  const all = [
    ...data.architecture,
    ...data.businessRules,
    ...data.moneyAndRounding,
    ...data.singleSourceOfTruth,
    ...data.futureExtensibility,
  ];
  if (all.length === 0) return 0;
  const passed = all.filter((c) => c.passed).length;
  return Math.round((passed / all.length) * 100);
}

export function buildPricingReport(data: PricingReportData): PricingReport {
  const productionReadinessScore = computeScore(data);
  return {
    ...data,
    productionReadinessScore,
    // Same convention affiliate-report-generator.ts documents: every
    // category here is load-bearing (unlike affiliate's own
    // "integrationReadiness" section, this module has no analogous
    // "not-yet-wired-up" bucket) — production-readiness requires every
    // check across every category to pass.
    isProductionReady: [
      ...data.architecture,
      ...data.businessRules,
      ...data.moneyAndRounding,
      ...data.singleSourceOfTruth,
      ...data.futureExtensibility,
    ].every((c) => c.passed),
  };
}

export function renderMarkdownPricingReport(report: PricingReport): string {
  const lines: string[] = [];
  lines.push("# MaestroYa — Pricing & Commission Engine Report (Module 64)");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Overall Readiness Score: ${report.productionReadinessScore} / 100`);
  lines.push(`Production Ready: ${report.isProductionReady ? "YES" : "NO"}`);
  lines.push("");

  lines.push("## Platform Revenue Summary");
  lines.push("");
  if (report.statistics) {
    const s = report.statistics;
    lines.push(`Gross labor volume: ${s.grossLaborVolume.toFixed(2)}`);
    lines.push(`Gross materials volume: ${s.grossMaterialsVolume.toFixed(2)}`);
    lines.push(`Professional commissions (flat 10% of labor+materials): ${s.professionalCommissions.toFixed(2)}`);
    lines.push(`Platform gross revenue: ${s.platformGrossRevenue.toFixed(2)}`);
    lines.push(`Payouts total: ${s.payoutsTotal.toFixed(2)}`);
    lines.push(`Captured payment count: ${s.paymentCount}`);
  } else {
    lines.push("_Database was unreachable when this report was generated — statistics unavailable. See the CLI's own console warning for detail._");
  }
  lines.push("");

  lines.push("## Architecture Validation");
  lines.push("");
  lines.push(renderCheckTable(report.architecture));
  lines.push("");

  lines.push("## Business Rule Checks");
  lines.push("");
  lines.push(renderCheckTable(report.businessRules));
  lines.push("");

  lines.push("## Money & Rounding Checks");
  lines.push("");
  lines.push(renderCheckTable(report.moneyAndRounding));
  lines.push("");

  lines.push("## Single Source of Truth Checks");
  lines.push("");
  lines.push(renderCheckTable(report.singleSourceOfTruth));
  lines.push("");

  lines.push("## Future Extensibility Checks");
  lines.push("");
  lines.push(renderCheckTable(report.futureExtensibility));
  lines.push("");

  return lines.join("\n");
}

function renderCheckTable(checks: CheckResult[]): string {
  const lines = ["| Check | Result | Detail |", "| --- | --- | --- |"];
  for (const c of checks) {
    lines.push(`| ${c.check} | ${c.passed ? "PASS" : "FAIL"} | ${c.detail} |`);
  }
  return lines.join("\n");
}
