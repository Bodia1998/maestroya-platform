import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { getRunMultiInstanceSafetyAuditUseCase } from "@/infrastructure/multi-instance-safety/compose";
import { renderMarkdownReport, toJsonReport } from "@/infrastructure/multi-instance-safety/report-generator";

/**
 * Module 58 — Multi-Instance Safety Audit.
 *
 * Standalone entry point, run via `npm run multi-instance-audit` —
 * `tsx --conditions=react-server scripts/run-multi-instance-safety-audit.ts`,
 * the same runner/condition `scripts/run-capacity-report.ts` (Module 57)
 * uses, since `infrastructure/multi-instance-safety/compose.ts` (like
 * every other `compose.ts` in this codebase) is marked `"server-only"`.
 *
 * Runs every registered `SafetyChecker` through
 * `RunMultiInstanceSafetyAuditUseCase` (pure, read-only static analysis
 * over this repository's own source tree — no external system, no
 * database, no Redis connection required), renders the result as both
 * Markdown and JSON, and writes both to `reports/` at the project root.
 *
 * ## No persistence, unlike Module 57
 * Unlike `run-capacity-report.ts`, there is no report-anchoring database
 * row to persist here and therefore no non-fatal try/catch around a
 * persistence call — this module holds no persistence layer at all (see
 * `compose.ts`'s own doc comment for why). The only failure modes are
 * "a checker itself threw" (already converted into a CRITICAL finding by
 * `RunMultiInstanceSafetyAuditUseCase`, so `execute()` still resolves)
 * and "writing the report files failed" (a genuine, fatal error for this
 * CLI — there would be nothing left to report).
 */
async function main(): Promise<void> {
  const useCase = getRunMultiInstanceSafetyAuditUseCase();
  const report = await useCase.execute();

  const markdown = renderMarkdownReport(report);
  const json = toJsonReport(report);

  const reportsDir = path.resolve(process.cwd(), "reports");
  await mkdir(reportsDir, { recursive: true });

  const mdPath = path.join(reportsDir, "multi-instance-safety-report.md");
  const jsonPath = path.join(reportsDir, "multi-instance-safety-report.json");
  await writeFile(mdPath, markdown, "utf8");
  await writeFile(jsonPath, JSON.stringify(json, null, 2), "utf8");

  console.log(`MaestroYa Multi-Instance Safety Audit`);
  console.log(`Overall Score: ${report.overallScore} / 100`);
  console.log(`Production Ready: ${report.isProductionReady ? "YES" : "NO"}`);
  console.log(`Subsystems audited: ${report.subsystems.length}`);
  console.log(`Passed checks: ${report.totalPassedChecks}`);
  console.log(`Warnings: ${report.allWarnings.length}`);
  console.log(`Critical issues: ${report.allCriticalIssues.length}`);
  console.log(`Written: ${mdPath}`);
  console.log(`Written: ${jsonPath}`);
}

main().catch((error: unknown) => {
  console.error("multi-instance-safety-audit failed:", error);
  process.exitCode = 1;
});
