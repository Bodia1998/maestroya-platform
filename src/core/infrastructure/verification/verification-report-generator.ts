import { PROFESSIONAL_VERIFICATION_STATUS_VALUES } from "@/domain/services/professional-verification-rules";
import type { VERIFICATION_PROVIDER_VALUES } from "@/domain/services/professional-verification-rules";

/**
 * Module 59 — Professional Verification (Persona): pure data → markdown/JSON
 * rendering for `npm run verification-report`, split out of
 * `scripts/run-verification-report.ts` the same way
 * `infrastructure/performance/report-generator.ts` is split out of
 * `scripts/run-capacity-report.ts` — the script gathers data (some of it
 * possibly unavailable, e.g. no database connection), this file only knows
 * how to render whatever it was handed.
 */

export interface ProviderReportEntry {
  name: (typeof VERIFICATION_PROVIDER_VALUES)[number];
  /** Whether this process is actually wired to use this provider right
   *  now (`VerificationProvider.name` from the factory), vs. merely being
   *  a provider the codebase supports. */
  active: boolean;
  /** Whether the provider's own required config (credentials/template)
   *  is present — never the credential values themselves. */
  configured: boolean;
  notes: string;
}

export interface CheckResult {
  check: string;
  passed: boolean;
  detail: string;
}

export interface VerificationReportData {
  generatedAt: string;
  providers: ProviderReportEntry[];
  /** `null` when the database could not be reached — the report is still
   *  written with every non-DB-dependent section populated (see
   *  `scripts/run-verification-report.ts`'s own doc comment for why this
   *  is never a fatal error for the CLI). */
  statusDistribution: Record<string, number> | null;
  totalCases: number | null;
  syncableCases: number | null;
  security: CheckResult[];
  architecture: CheckResult[];
  integrationReadiness: CheckResult[];
}

export interface VerificationReport extends VerificationReportData {
  productionReadinessScore: number;
  isProductionReady: boolean;
}

function computeScore(data: VerificationReportData): number {
  const all = [...data.security, ...data.architecture, ...data.integrationReadiness];
  if (all.length === 0) return 0;
  const passed = all.filter((c) => c.passed).length;
  return Math.round((passed / all.length) * 100);
}

export function buildVerificationReport(data: VerificationReportData): VerificationReport {
  const productionReadinessScore = computeScore(data);
  return {
    ...data,
    productionReadinessScore,
    // "Production ready" requires every architecture/security check to
    // pass — integration-readiness items (e.g. "a real Persona provider is
    // configured") are informational, since `manual`-only is itself a
    // legitimate, fully production-ready configuration (see
    // `VERIFICATION_PROVIDER`'s own doc comment in env.ts).
    isProductionReady: [...data.security, ...data.architecture].every((c) => c.passed),
  };
}

export function renderMarkdownVerificationReport(report: VerificationReport): string {
  const lines: string[] = [];
  lines.push("# MaestroYa — Professional Verification Report (Module 59)");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Overall Readiness Score: ${report.productionReadinessScore} / 100`);
  lines.push(`Production Ready: ${report.isProductionReady ? "YES" : "NO"}`);
  lines.push("");

  lines.push("## Supported Providers");
  lines.push("");
  lines.push("| Provider | Active | Configured | Notes |");
  lines.push("| --- | --- | --- | --- |");
  for (const p of report.providers) {
    lines.push(`| ${p.name} | ${p.active ? "yes" : "no"} | ${p.configured ? "yes" : "no"} | ${p.notes} |`);
  }
  lines.push("");

  lines.push("## Verification Statistics");
  lines.push("");
  if (report.statusDistribution && report.totalCases !== null) {
    lines.push(`Total cases: ${report.totalCases}`);
    lines.push(`Cases awaiting provider sync: ${report.syncableCases ?? 0}`);
    lines.push("");
    lines.push("| Status | Count |");
    lines.push("| --- | --- |");
    for (const status of PROFESSIONAL_VERIFICATION_STATUS_VALUES) {
      lines.push(`| ${status} | ${report.statusDistribution[status] ?? 0} |`);
    }
  } else {
    lines.push("_Database was unreachable when this report was generated — statistics unavailable. See the CLI's own console warning for detail._");
  }
  lines.push("");

  lines.push("## Security Checks");
  lines.push("");
  lines.push(renderCheckTable(report.security));
  lines.push("");

  lines.push("## Architecture Validation");
  lines.push("");
  lines.push(renderCheckTable(report.architecture));
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
