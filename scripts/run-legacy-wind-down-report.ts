import type { LegacyWindDownReport } from "@/application/use-cases/legacy-wind-down/generate-legacy-wind-down-report.use-case";
import { makeGenerateLegacyWindDownReportUseCase } from "@/application/use-cases/legacy-wind-down/compose";

/**
 * Module 166 — Legacy Wind-Down & Final Settlement: standalone, READ-ONLY entry point.
 *
 *   npm run legacy-wind-down-report            # Markdown on stdout
 *   npm run legacy-wind-down-report -- --json  # JSON on stdout (accounting/audit hand-off)
 *
 * It reports whatever database the environment points at, using a single READ ONLY / REPEATABLE READ transaction (the database
 * itself refuses writes), so running it is safe by construction — but it is an operator tool: point it at a disposable database
 * for development, and at a production database only deliberately, and never as part of CI. It writes no file, changes no record,
 * resolves nothing and is wired to no route or cron.
 *
 * FAIL CLOSED: if the database cannot be read (or an inventory table exceeds its ceiling) the script prints the error and exits
 * with code 2. It NEVER prints an empty or "clean" report in that case.
 *
 * Exit codes: 0 = report produced and the data side has no blocking finding (still NOT "Gate C passed": see the report's
 * external confirmations); 1 = report produced and blocking findings exist; 2 = report could not be produced.
 */

function renderMarkdown(report: LegacyWindDownReport): string {
  const lines: string[] = [];
  lines.push("# Legacy wind-down inventory (Module 166)", "");
  lines.push(`> ${report.notice}`, "");
  lines.push(`- Rules version: ${report.rulesVersion}`);
  lines.push(`- Generated at: ${report.generatedAt.toISOString()}`);
  lines.push(`- Decision: **${report.readiness.decision}** (data clean: ${report.readiness.dataClean ? "yes" : "no"})`);
  lines.push(`- Legacy requests total: ${report.context.legacyRequestTotal}; newest created: ${report.context.newestLegacyRequestCreatedAt?.toISOString() ?? "none"}`);
  lines.push(`- Latest legacy financial change: ${report.context.latestLegacyFinancialChangeAt?.toISOString() ?? "none"}`);
  const run = report.context.latestCompletedFullRun;
  lines.push(`- Latest COMPLETED FULL reconciliation run: ${run ? `${run.id} started ${run.startedAt.toISOString()}, records inspected ${run.recordsInspected} (a bounded batch: not proof of full coverage)` : "none"}`, "");
  lines.push("## Open items", "");
  if (report.items.length === 0) lines.push("None.", "");
  for (const item of report.items) {
    lines.push(`### ${item.code} — ${item.count} (${item.severity}, ${item.verification})`, "");
    lines.push(`- By status: ${Object.entries(item.byStatus).map(([k, v]) => `${k}=${v}`).join(", ") || "n/a"}`);
    if (item.amountByCurrency) lines.push(`- Amount (exact, not netted): ${Object.entries(item.amountByCurrency).map(([k, v]) => `${v} ${k}`).join(", ") || "n/a"}`);
    if (item.ids.length > 0) lines.push(`- Ids${item.idsTruncated ? " (truncated)" : ""}: ${item.ids.join(", ")}`);
    lines.push(`- Next action: ${item.nextAction}`, "");
  }
  lines.push("## External confirmations (never verifiable from the repository)", "");
  for (const c of report.readiness.externalConfirmations) lines.push(`- [ ] ${c.id}: ${c.description}`);
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<number> {
  const asJson = process.argv.includes("--json");
  let report: LegacyWindDownReport;
  try {
    report = await makeGenerateLegacyWindDownReportUseCase().execute();
  } catch (error) {
    console.error("legacy-wind-down-report: the inventory could not be produced; no report was written (fail closed).", error);
    return 2;
  }
  process.stdout.write(asJson ? `${JSON.stringify(report, null, 2)}\n` : `${renderMarkdown(report)}\n`);
  return report.readiness.dataClean ? 0 : 1;
}

void main().then(
  (code) => process.exit(code),
  (error) => {
    console.error("legacy-wind-down-report: unexpected failure (fail closed).", error);
    process.exit(2);
  },
);
