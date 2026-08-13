import type { ReferralStatistics } from "@/application/use-cases/referral/get-referral-statistics.use-case";

/**
 * Module 60 — Referral & Marketing Attribution Platform: pure data ->
 * markdown/JSON rendering for `npm run referral-report`, split out of
 * `scripts/run-referral-report.ts` the same way
 * `infrastructure/verification/verification-report-generator.ts` is split
 * out of `scripts/run-verification-report.ts` — the script gathers data
 * (possibly unavailable, e.g. no database connection), this file only
 * knows how to render whatever it was handed.
 */
export interface CheckResult {
  check: string;
  passed: boolean;
  detail: string;
}

export interface ReferralReportData {
  generatedAt: string;
  /** `null` when the database could not be reached — the report is still
   *  written with every non-DB-dependent section populated, mirroring
   *  `VerificationReportData.statusDistribution`'s own null convention. */
  statistics: ReferralStatistics | null;
  architecture: CheckResult[];
  privacy: CheckResult[];
  integrationReadiness: CheckResult[];
}

export interface ReferralReport extends ReferralReportData {
  productionReadinessScore: number;
  isProductionReady: boolean;
}

function computeScore(data: ReferralReportData): number {
  const all = [...data.architecture, ...data.privacy, ...data.integrationReadiness];
  if (all.length === 0) return 0;
  const passed = all.filter((c) => c.passed).length;
  return Math.round((passed / all.length) * 100);
}

export function buildReferralReport(data: ReferralReportData): ReferralReport {
  const productionReadinessScore = computeScore(data);
  return {
    ...data,
    productionReadinessScore,
    // Same convention as verification-report-generator.ts's own
    // isProductionReady: integration-readiness items (e.g. "another
    // module already calls RecordConversionUseCase") are informational —
    // this module is fully production-ready as a standalone
    // tracking/attribution layer even before anything downstream wires
    // into it.
    isProductionReady: [...data.architecture, ...data.privacy].every((c) => c.passed),
  };
}

export function renderMarkdownReferralReport(report: ReferralReport): string {
  const lines: string[] = [];
  lines.push("# MaestroYa — Referral & Marketing Attribution Report (Module 60)");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Overall Readiness Score: ${report.productionReadinessScore} / 100`);
  lines.push(`Production Ready: ${report.isProductionReady ? "YES" : "NO"}`);
  lines.push("");

  lines.push("## Funnel & Attribution Statistics");
  lines.push("");
  if (report.statistics) {
    const s = report.statistics;
    lines.push(`Total visits: ${s.totalVisits}`);
    lines.push(`Attributed visitors: ${s.totalAttributedVisitors}`);
    lines.push(`Registered visitors (userId linked): ${s.totalRegisteredVisitors}`);
    lines.push(`Registrations (conversion events): ${s.registrations}`);
    lines.push(`  - Professional: ${s.professionalRegistrations}`);
    lines.push(`  - Client: ${s.clientRegistrations}`);
    lines.push(`Bookings created: ${s.bookingsCreated}`);
    lines.push(`Bookings completed: ${s.bookingsCompleted}`);
    lines.push(`Commissions generated (read-only marker count): ${s.commissionsGenerated}`);
    lines.push(`Revenue attributed total: ${s.revenueAttributedTotal.toFixed(2)}`);
    lines.push("");
    lines.push("| Funnel stage | Rate |");
    lines.push("| --- | --- |");
    lines.push(`| Visit -> Registration | ${(s.visitToRegistrationRate * 100).toFixed(2)}% |`);
    lines.push(`| Registration -> Booking Created | ${(s.registrationToBookingRate * 100).toFixed(2)}% |`);
    lines.push(`| Booking Created -> Completed | ${(s.bookingCompletionRate * 100).toFixed(2)}% |`);
    lines.push("");
    lines.push("### Top Referral Codes");
    lines.push("");
    lines.push("| Referral Code | Visits |");
    lines.push("| --- | --- |");
    if (s.topReferralCodes.length === 0) {
      lines.push("| _none tracked yet_ | — |");
    }
    for (const c of s.topReferralCodes) {
      lines.push(`| ${c.referralCode} | ${c.visits} |`);
    }
    lines.push("");
    lines.push("### Top Campaigns");
    lines.push("");
    lines.push("| Campaign | Visits |");
    lines.push("| --- | --- |");
    if (s.topCampaigns.length === 0) {
      lines.push("| _none tracked yet_ | — |");
    }
    for (const c of s.topCampaigns) {
      lines.push(`| ${c.campaign} | ${c.visits} |`);
    }
  } else {
    lines.push("_Database was unreachable when this report was generated — statistics unavailable. See the CLI's own console warning for detail._");
  }
  lines.push("");

  lines.push("## Architecture Validation");
  lines.push("");
  lines.push(renderCheckTable(report.architecture));
  lines.push("");

  lines.push("## Privacy Checks");
  lines.push("");
  lines.push(renderCheckTable(report.privacy));
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
