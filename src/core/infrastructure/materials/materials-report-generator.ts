import type { MaterialsStatistics } from "@/application/use-cases/materials/get-materials-statistics.use-case";

/**
 * Module 63 — Materials Procurement Workflow: pure data -> markdown/JSON
 * rendering for `npm run materials-report`, split out of
 * `scripts/run-materials-report.ts` the same way
 * `infrastructure/referral/referral-report-generator.ts` is split out of
 * `scripts/run-referral-report.ts` — the script gathers data (possibly
 * unavailable, e.g. no database connection), this file only knows how to
 * render whatever it was handed.
 */
export interface CheckResult {
  check: string;
  passed: boolean;
  detail: string;
}

export interface MaterialsReportData {
  generatedAt: string;
  /** `null` when the database could not be reached — the report is still
   *  written with every non-DB-dependent section populated, mirroring
   *  ReferralReportData.statistics' own null convention. */
  statistics: MaterialsStatistics | null;
  architecture: CheckResult[];
  businessRules: CheckResult[];
  integrationReadiness: CheckResult[];
}

export interface MaterialsReport extends MaterialsReportData {
  productionReadinessScore: number;
  isProductionReady: boolean;
}

function computeScore(data: MaterialsReportData): number {
  const all = [...data.architecture, ...data.businessRules, ...data.integrationReadiness];
  if (all.length === 0) return 0;
  const passed = all.filter((c) => c.passed).length;
  return Math.round((passed / all.length) * 100);
}

export function buildMaterialsReport(data: MaterialsReportData): MaterialsReport {
  const productionReadinessScore = computeScore(data);
  return {
    ...data,
    productionReadinessScore,
    // Same convention as referral-report-generator.ts's own
    // isProductionReady: integration-readiness items are informational —
    // this module is fully production-ready as a standalone workflow even
    // before every consumer (UI, another module) is wired into it.
    isProductionReady: [...data.architecture, ...data.businessRules].every((c) => c.passed),
  };
}

function renderCheckTable(checks: CheckResult[]): string {
  const lines = ["| Check | Result | Detail |", "| --- | --- | --- |"];
  for (const c of checks) {
    lines.push(`| ${c.check} | ${c.passed ? "PASS" : "FAIL"} | ${c.detail} |`);
  }
  return lines.join("\n");
}

export function renderMarkdownMaterialsReport(report: MaterialsReport): string {
  const lines: string[] = [];
  lines.push("# MaestroYa — Materials Procurement Workflow Report (Module 63)");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Overall Readiness Score: ${report.productionReadinessScore} / 100`);
  lines.push(`Production Ready: ${report.isProductionReady ? "YES" : "NO"}`);
  lines.push("");

  lines.push("## Materials Strategy Statistics");
  lines.push("");
  if (report.statistics) {
    const s = report.statistics;
    lines.push(`Total quotes: ${s.totalQuotes}`);
    lines.push(`Professional-supplied: ${s.professionalSuppliedQuotes}`);
    lines.push(`Customer-purchased: ${s.customerPurchasedQuotes}`);
    lines.push(`  - Confirmed purchased: ${s.customerPurchasedConfirmed}`);
    lines.push(`  - Awaiting confirmation: ${s.customerPurchasedAwaitingConfirmation}`);
    lines.push(`Total materials listed across all quotes: ${s.totalMaterialsListed}`);
  } else {
    lines.push(
      "_Database was unreachable when this report was generated — statistics unavailable. See the CLI's own console warning for detail._",
    );
  }
  lines.push("");

  lines.push("## Architecture Validation");
  lines.push("");
  lines.push(renderCheckTable(report.architecture));
  lines.push("");

  lines.push("## Business Rules");
  lines.push("");
  lines.push(renderCheckTable(report.businessRules));
  lines.push("");

  lines.push("## Integration Readiness");
  lines.push("");
  lines.push(renderCheckTable(report.integrationReadiness));
  lines.push("");

  return lines.join("\n");
}
