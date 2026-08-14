/**
 * Module 61 — Affiliate & Partner System: pure data -> markdown/JSON
 * rendering for `npm run affiliate-report`, split out of
 * `scripts/run-affiliate-report.ts` — same "the script gathers data
 * (possibly unavailable), this file only knows how to render whatever it
 * was handed" convention `infrastructure/referral/referral-report-generator.ts`
 * establishes for Module 60.
 */
export interface CheckResult {
  check: string;
  passed: boolean;
  detail: string;
}

export interface AffiliateSummaryStatistics {
  totalPartners: number;
  pendingPartners: number;
  approvedPartners: number;
  suspendedPartners: number;
  bannedPartners: number;
  rejectedPartners: number;
  totalAffiliateCommissions: number;
  pendingCommissionTotal: number;
  approvedCommissionTotal: number;
  paidCommissionTotal: number;
  totalPlatformCommissionGenerated: number;
  openFraudFlags: number;
}

export interface AffiliateReportData {
  generatedAt: string;
  /** `null` when the database could not be reached — same convention
   *  `ReferralReportData.statistics` documents. */
  statistics: AffiliateSummaryStatistics | null;
  architecture: CheckResult[];
  commissionPolicy: CheckResult[];
  integrationReadiness: CheckResult[];
}

export interface AffiliateReport extends AffiliateReportData {
  productionReadinessScore: number;
  isProductionReady: boolean;
}

function computeScore(data: AffiliateReportData): number {
  const all = [...data.architecture, ...data.commissionPolicy, ...data.integrationReadiness];
  if (all.length === 0) return 0;
  const passed = all.filter((c) => c.passed).length;
  return Math.round((passed / all.length) * 100);
}

export function buildAffiliateReport(data: AffiliateReportData): AffiliateReport {
  const productionReadinessScore = computeScore(data);
  return {
    ...data,
    productionReadinessScore,
    // Same convention referral-report-generator.ts documents:
    // integration-readiness items are informational — this module is fully
    // production-ready as a standalone Partner System even before another
    // module's Payment/Commission use case actually calls into it.
    isProductionReady: [...data.architecture, ...data.commissionPolicy].every((c) => c.passed),
  };
}

export function renderMarkdownAffiliateReport(report: AffiliateReport): string {
  const lines: string[] = [];
  lines.push("# MaestroYa — Affiliate & Partner System Report (Module 61)");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Overall Readiness Score: ${report.productionReadinessScore} / 100`);
  lines.push(`Production Ready: ${report.isProductionReady ? "YES" : "NO"}`);
  lines.push("");

  lines.push("## Partner & Commission Summary");
  lines.push("");
  if (report.statistics) {
    const s = report.statistics;
    lines.push(`Total partners: ${s.totalPartners}`);
    lines.push(`  - Pending: ${s.pendingPartners}`);
    lines.push(`  - Approved: ${s.approvedPartners}`);
    lines.push(`  - Suspended: ${s.suspendedPartners}`);
    lines.push(`  - Banned: ${s.bannedPartners}`);
    lines.push(`  - Rejected: ${s.rejectedPartners}`);
    lines.push(`Total affiliate commission ledger rows: ${s.totalAffiliateCommissions}`);
    lines.push(`Pending affiliate commission total: ${s.pendingCommissionTotal.toFixed(2)}`);
    lines.push(`Approved affiliate commission total: ${s.approvedCommissionTotal.toFixed(2)}`);
    lines.push(`Paid affiliate commission total: ${s.paidCommissionTotal.toFixed(2)}`);
    lines.push(`Total MaestroYa platform commission that generated an affiliate payout: ${s.totalPlatformCommissionGenerated.toFixed(2)}`);
    lines.push(`Open fraud flags awaiting admin review: ${s.openFraudFlags}`);
  } else {
    lines.push("_Database was unreachable when this report was generated — statistics unavailable. See the CLI's own console warning for detail._");
  }
  lines.push("");

  lines.push("## Architecture Validation");
  lines.push("");
  lines.push(renderCheckTable(report.architecture));
  lines.push("");

  lines.push("## Commission Policy Checks");
  lines.push("");
  lines.push(renderCheckTable(report.commissionPolicy));
  lines.push("");

  lines.push("## Integration Readiness");
  lines.push("");
  lines.push(renderCheckTable(report.integrationReadiness));
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
