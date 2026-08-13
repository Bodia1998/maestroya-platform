import "server-only";

import type { AuditFinding } from "@/domain/entities/audit-finding";
import type { MultiInstanceSafetyReport } from "@/domain/entities/multi-instance-safety-report";
import type { SubsystemAuditResult, SubsystemStatus } from "@/domain/entities/subsystem-audit-result";

/**
 * Module 58 — Multi-Instance Safety Audit.
 *
 * Turns a `MultiInstanceSafetyReport` into a structured, presentation-ready
 * shape and both a human-readable Markdown rendering and a JSON
 * serialization — the same "reporting is a rendering concern, kept in
 * infrastructure not application" boundary `report-generator.ts` draws
 * for Module 57. This module has no persistence layer or API route: `npm
 * run multi-instance-audit` (`scripts/run-multi-instance-safety-audit.ts`)
 * is the only caller, writing this file's output to
 * `reports/multi-instance-safety-report.md` /
 * `reports/multi-instance-safety-report.json`.
 */

export type ReadinessStatus = "Green" | "Yellow" | "Red";

/** Maps a 0–100 overall score to a traffic-light band — identical cut lines to Module 57's `readinessStatusFor`, for the same reporting-convention reason: `>=90` Green, `70-89` Yellow (still within `MultiInstanceSafetyReport.isProductionReady`'s own `>=70` cut line), `<70` Red. */
export function readinessStatusFor(score: number): ReadinessStatus {
  if (score >= 90) return "Green";
  if (score >= 70) return "Yellow";
  return "Red";
}

export interface SubsystemReportRow {
  subsystem: string;
  status: SubsystemStatus;
  passedCheckCount: number;
  warningCount: number;
  criticalCount: number;
}

export interface FindingRow {
  id: string;
  subsystem: string;
  severity: AuditFinding["severity"];
  problem: string;
  risk: string;
  whyItHappens: string;
  impact: string;
  recommendedFix: string;
  priority: AuditFinding["priority"];
  evidence: readonly string[];
}

export interface StructuredMultiInstanceSafetyReport {
  generatedAt: string;
  overallScore: number;
  productionReady: boolean;
  readinessStatus: ReadinessStatus;
  subsystems: SubsystemReportRow[];
  passedChecks: string[];
  warnings: FindingRow[];
  criticalIssues: FindingRow[];
  recommendedActions: readonly string[];
  riskClassification: Record<SubsystemStatus, number>;
}

function toFindingRow(finding: AuditFinding): FindingRow {
  return {
    id: finding.id,
    subsystem: finding.subsystem,
    severity: finding.severity,
    problem: finding.problem,
    risk: finding.risk,
    whyItHappens: finding.whyItHappens,
    impact: finding.impact,
    recommendedFix: finding.recommendedFix,
    priority: finding.priority,
    evidence: finding.evidence,
  };
}

function buildSubsystemRows(subsystems: readonly SubsystemAuditResult[]): SubsystemReportRow[] {
  return subsystems.map((s) => ({
    subsystem: s.subsystem,
    status: s.status,
    passedCheckCount: s.passedChecks.length,
    warningCount: s.warnings.length,
    criticalCount: s.criticalIssues.length,
  }));
}

/** Counts subsystems per status — the "Risk classification" the report content requirement asks for: how many subsystems ended up SAFE vs. WARNING vs. CRITICAL. */
function buildRiskClassification(subsystems: readonly SubsystemAuditResult[]): Record<SubsystemStatus, number> {
  const classification: Record<SubsystemStatus, number> = { SAFE: 0, WARNING: 0, CRITICAL: 0 };
  for (const s of subsystems) classification[s.status] += 1;
  return classification;
}

export function buildStructuredReport(report: MultiInstanceSafetyReport): StructuredMultiInstanceSafetyReport {
  return {
    generatedAt: report.generatedAt.toISOString(),
    overallScore: report.overallScore,
    productionReady: report.isProductionReady,
    readinessStatus: readinessStatusFor(report.overallScore),
    subsystems: buildSubsystemRows(report.subsystems),
    passedChecks: report.subsystems.flatMap((s) => s.passedChecks),
    warnings: report.allWarnings.map(toFindingRow),
    criticalIssues: report.allCriticalIssues.map(toFindingRow),
    recommendedActions: report.recommendedActions,
    riskClassification: buildRiskClassification(report.subsystems),
  };
}

const STATUS_ICON: Record<SubsystemStatus, string> = { SAFE: "✅", WARNING: "⚠️", CRITICAL: "🛑" };

function renderFinding(lines: string[], finding: FindingRow): void {
  lines.push(`### [${finding.priority}] ${finding.subsystem} — ${finding.problem}`);
  lines.push(`- **Risk:** ${finding.risk}`);
  lines.push(`- **Why it happens:** ${finding.whyItHappens}`);
  lines.push(`- **Impact:** ${finding.impact}`);
  lines.push(`- **Recommended fix:** ${finding.recommendedFix}`);
  if (finding.evidence.length > 0) {
    lines.push(`- **Evidence:** ${finding.evidence.join(", ")}`);
  }
  lines.push("");
}

/** Renders `buildStructuredReport`'s output as Markdown — matching this module's documented report content requirements exactly: overall score, production-ready verdict, per-subsystem status, passed checks, warnings, critical issues (each with Problem/Risk/Why it happens/Impact/Recommended fix/Priority), recommended actions, and a risk classification. */
export function renderMarkdownReport(report: MultiInstanceSafetyReport): string {
  const structured = buildStructuredReport(report);
  const lines: string[] = [];
  const divider = "-".repeat(60);

  lines.push("# MaestroYa Multi-Instance Safety Audit", "");
  lines.push(`Generated: ${structured.generatedAt}`);
  lines.push(`Overall Score: ${structured.overallScore} / 100`);
  lines.push(`Production Ready (multi-instance): ${structured.productionReady ? "YES" : "NO"}`);
  lines.push(`Status: ${structured.readinessStatus}`, "");

  lines.push("## Risk Classification", "");
  lines.push(`- SAFE subsystems: ${structured.riskClassification.SAFE}`);
  lines.push(`- WARNING subsystems: ${structured.riskClassification.WARNING}`);
  lines.push(`- CRITICAL subsystems: ${structured.riskClassification.CRITICAL}`, "");

  lines.push("## Subsystems", "");
  for (const row of structured.subsystems) {
    lines.push(`${STATUS_ICON[row.status]} **${row.subsystem}** — ${row.status} (${row.passedCheckCount} passed, ${row.warningCount} warning, ${row.criticalCount} critical)`);
  }
  lines.push("");

  lines.push(divider, "## Critical Issues", "");
  if (structured.criticalIssues.length === 0) {
    lines.push("None identified.", "");
  } else {
    for (const finding of structured.criticalIssues) renderFinding(lines, finding);
  }

  lines.push(divider, "## Warnings", "");
  if (structured.warnings.length === 0) {
    lines.push("None identified.", "");
  } else {
    for (const finding of structured.warnings) renderFinding(lines, finding);
  }

  lines.push(divider, "## Passed Checks", "");
  if (structured.passedChecks.length === 0) {
    lines.push("None recorded.", "");
  } else {
    for (const check of structured.passedChecks) lines.push(`- ${check}`);
    lines.push("");
  }

  lines.push(divider, "## Recommended Actions", "");
  if (structured.recommendedActions.length === 0) {
    lines.push("No further action needed.");
  } else {
    structured.recommendedActions.forEach((action, index) => lines.push(`${index + 1}. ${action}`));
  }

  return lines.join("\n");
}

/** JSON-serializable form of the same report — same data as `renderMarkdownReport`, structured for machine consumption (e.g. a CI step that diffs successive audits). */
export function toJsonReport(report: MultiInstanceSafetyReport): StructuredMultiInstanceSafetyReport {
  return buildStructuredReport(report);
}
