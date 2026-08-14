/**
 * Module 65 — Trust & Integrity System: pure data -> markdown/JSON
 * rendering for `npm run trust-report`, split out of
 * `scripts/run-trust-report.ts` — same "the script gathers data (possibly
 * unavailable), this file only knows how to render whatever it was
 * handed" convention `infrastructure/pricing/pricing-report-generator.ts`
 * (Module 64) establishes.
 */
export interface CheckResult {
  check: string;
  passed: boolean;
  detail: string;
}

export interface TrustIntegritySummaryStatistics {
  totalTrustProfiles: number;
  usersAtOrAboveWarningRisk: number;
  usersAtOrAboveSuspensionRisk: number;
  usersWithLowTrust: number;
  openFraudSignals: number;
  totalFraudSignals: number;
  offPlatformDetectionEventsTotal: number;
  activeAutomatedActions: number;
  totalAutomatedActions: number;
  openManualReviewCases: number;
  totalManualReviewCases: number;
  pendingAppeals: number;
  totalAppeals: number;
}

export interface TrustIntegrityReportData {
  generatedAt: string;
  /** `null` when the database could not be reached — same convention
   *  `PricingReportData.statistics` documents. */
  statistics: TrustIntegritySummaryStatistics | null;
  architectureValidation: CheckResult[];
  businessRulesValidation: CheckResult[];
  fraudDetectionCoverage: CheckResult[];
  riskEngineValidation: CheckResult[];
  trustScoreValidation: CheckResult[];
  futureIntegrationReadiness: CheckResult[];
}

export interface TrustIntegrityReport extends TrustIntegrityReportData {
  productionReadinessScore: number;
  isProductionReady: boolean;
}

function computeScore(data: TrustIntegrityReportData): number {
  const all = [
    ...data.architectureValidation,
    ...data.businessRulesValidation,
    ...data.fraudDetectionCoverage,
    ...data.riskEngineValidation,
    ...data.trustScoreValidation,
    ...data.futureIntegrationReadiness,
  ];
  if (all.length === 0) return 0;
  const passed = all.filter((c) => c.passed).length;
  return Math.round((passed / all.length) * 100);
}

export function buildTrustIntegrityReport(data: TrustIntegrityReportData): TrustIntegrityReport {
  const productionReadinessScore = computeScore(data);
  return {
    ...data,
    productionReadinessScore,
    isProductionReady: [
      ...data.architectureValidation,
      ...data.businessRulesValidation,
      ...data.fraudDetectionCoverage,
      ...data.riskEngineValidation,
      ...data.trustScoreValidation,
      ...data.futureIntegrationReadiness,
    ].every((c) => c.passed),
  };
}

export function renderMarkdownTrustIntegrityReport(report: TrustIntegrityReport): string {
  const lines: string[] = [];
  lines.push("# MaestroYa — Trust & Integrity System Report (Module 65)");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Overall Readiness Score: ${report.productionReadinessScore} / 100`);
  lines.push(`Production Ready: ${report.isProductionReady ? "YES" : "NO"}`);
  lines.push("");

  lines.push("## Platform Trust & Risk Summary");
  lines.push("");
  if (report.statistics) {
    const s = report.statistics;
    lines.push(`Total trust profiles: ${s.totalTrustProfiles}`);
    lines.push(`Users at or above WARNING risk tier: ${s.usersAtOrAboveWarningRisk}`);
    lines.push(`Users at or above SUSPENSION risk tier: ${s.usersAtOrAboveSuspensionRisk}`);
    lines.push(`Users with low trust (<= 30): ${s.usersWithLowTrust}`);
    lines.push(`Open fraud signals: ${s.openFraudSignals} (of ${s.totalFraudSignals} total)`);
    lines.push(`Off-platform detection events recorded: ${s.offPlatformDetectionEventsTotal}`);
    lines.push(`Active automated actions: ${s.activeAutomatedActions} (of ${s.totalAutomatedActions} total)`);
    lines.push(`Open manual review cases: ${s.openManualReviewCases} (of ${s.totalManualReviewCases} total)`);
    lines.push(`Pending appeals: ${s.pendingAppeals} (of ${s.totalAppeals} total)`);
  } else {
    lines.push("_Database was unreachable when this report was generated — statistics unavailable. See the CLI's own console warning for detail._");
  }
  lines.push("");

  lines.push("## Architecture Validation");
  lines.push("");
  lines.push(renderCheckTable(report.architectureValidation));
  lines.push("");

  lines.push("## Business Rules Validation");
  lines.push("");
  lines.push(renderCheckTable(report.businessRulesValidation));
  lines.push("");

  lines.push("## Fraud Detection Coverage");
  lines.push("");
  lines.push(renderCheckTable(report.fraudDetectionCoverage));
  lines.push("");

  lines.push("## Risk Engine Validation");
  lines.push("");
  lines.push(renderCheckTable(report.riskEngineValidation));
  lines.push("");

  lines.push("## Trust Score Validation");
  lines.push("");
  lines.push(renderCheckTable(report.trustScoreValidation));
  lines.push("");

  lines.push("## Future Integration Readiness");
  lines.push("");
  lines.push(renderCheckTable(report.futureIntegrationReadiness));
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
