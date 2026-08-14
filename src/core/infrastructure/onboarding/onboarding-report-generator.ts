import { ONBOARDING_STEP_VALUES } from "@/domain/services/professional-onboarding-rules";

/**
 * Module 62 — Professional Onboarding: pure data → markdown/JSON rendering
 * for `npm run onboarding-report`, split out of
 * `scripts/run-onboarding-report.ts` the same way `infrastructure/
 * verification/verification-report-generator.ts` is split out of
 * `scripts/run-verification-report.ts` — the script gathers data (some of
 * it possibly unavailable, e.g. no database connection), this file only
 * knows how to render whatever it was handed.
 */

export interface CheckResult {
  check: string;
  passed: boolean;
  detail: string;
}

export interface OnboardingReportData {
  generatedAt: string;
  /** `null` when the database could not be reached — the report is still
   *  written with every non-DB-dependent section populated (see
   *  `scripts/run-onboarding-report.ts`'s own doc comment for why this is
   *  never a fatal error for the CLI). */
  inProgressCount: number | null;
  activatedCount: number | null;
  architecture: CheckResult[];
  activationRules: CheckResult[];
  providerAbstraction: CheckResult[];
  verificationIntegration: CheckResult[];
  stripeReadiness: CheckResult[];
  onboardingCompleteness: CheckResult[];
}

export interface OnboardingReport extends OnboardingReportData {
  productionReadinessScore: number;
  isProductionReady: boolean;
}

function allChecks(data: OnboardingReportData): CheckResult[] {
  return [
    ...data.architecture,
    ...data.activationRules,
    ...data.providerAbstraction,
    ...data.verificationIntegration,
    ...data.stripeReadiness,
    ...data.onboardingCompleteness,
  ];
}

function computeScore(data: OnboardingReportData): number {
  const all = allChecks(data);
  if (all.length === 0) return 0;
  const passed = all.filter((c) => c.passed).length;
  return Math.round((passed / all.length) * 100);
}

export function buildOnboardingReport(data: OnboardingReportData): OnboardingReport {
  const productionReadinessScore = computeScore(data);
  return {
    ...data,
    productionReadinessScore,
    // "Production ready" requires every check to pass except
    // stripeReadiness — Stripe Express integration is explicitly future
    // (Module 65) scope; this module only prepares state for it, so a
    // not-yet-real Stripe account is expected, not a defect. Mirrors
    // verification-report-generator.ts's own "integration readiness never
    // counts against production readiness" rule.
    isProductionReady: [
      ...data.architecture,
      ...data.activationRules,
      ...data.providerAbstraction,
      ...data.verificationIntegration,
      ...data.onboardingCompleteness,
    ].every((c) => c.passed),
  };
}

export function renderMarkdownOnboardingReport(report: OnboardingReport): string {
  const lines: string[] = [];
  lines.push("# MaestroYa — Professional Onboarding Report (Module 62)");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Overall Readiness Score: ${report.productionReadinessScore} / 100`);
  lines.push(`Production Ready: ${report.isProductionReady ? "YES" : "NO"}`);
  lines.push("");

  lines.push("## Onboarding Statistics");
  lines.push("");
  if (report.inProgressCount !== null && report.activatedCount !== null) {
    lines.push(`In progress: ${report.inProgressCount}`);
    lines.push(`Activated: ${report.activatedCount}`);
    lines.push(`Onboarding steps: ${ONBOARDING_STEP_VALUES.join(", ")}`);
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

  lines.push("## Activation Rules");
  lines.push("");
  lines.push(renderCheckTable(report.activationRules));
  lines.push("");

  lines.push("## Provider Abstraction (Bank Account / Stripe Express)");
  lines.push("");
  lines.push(renderCheckTable(report.providerAbstraction));
  lines.push("");

  lines.push("## Identity Verification Integration (Module 17/59)");
  lines.push("");
  lines.push(renderCheckTable(report.verificationIntegration));
  lines.push("");

  lines.push("## Future Stripe Readiness (Module 65)");
  lines.push("");
  lines.push(renderCheckTable(report.stripeReadiness));
  lines.push("");

  lines.push("## Onboarding Completeness");
  lines.push("");
  lines.push(renderCheckTable(report.onboardingCompleteness));
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
