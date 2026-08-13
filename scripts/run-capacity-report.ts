import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PERFORMANCE_SCENARIO_CATALOG } from "@/application/services/performance/performance-scenario-catalog";
import { getGenerateCapacityReportUseCase, getPersistCapacityReportUseCase } from "@/infrastructure/performance/compose";
import { renderMarkdownReport, toJsonReport } from "@/infrastructure/performance/report-generator";

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * Standalone entry point, run via `npm run capacity-report` (alias
 * `npm run load-test`) — `tsx --conditions=react-server
 * scripts/run-capacity-report.ts`, the same runner/condition
 * `scripts/realtime-gateway.ts` (Module 48) uses, since
 * `infrastructure/performance/compose.ts` (like every other `compose.ts`
 * in this codebase) is marked `"server-only"`.
 *
 * Runs every scenario in `PERFORMANCE_SCENARIO_CATALOG` through
 * `GenerateCapacityReportUseCase` (an in-process, seeded simulation — no
 * external system, no database; each scenario's aggregated result is
 * persisted as it runs, and compared against/auto-captures the scenario's
 * stored baseline — see that use case's own doc comment), renders the
 * result as both Markdown and JSON, writes both to `reports/` at the
 * project root, and persists the report-anchoring `LoadTestRun` row via
 * `PersistCapacityReportUseCase`.
 *
 * ## Persistence failures are non-fatal
 * `PersistCapacityReportUseCase.execute()` is wrapped in its own
 * try/catch here, separate from `GenerateCapacityReportUseCase`'s own
 * internal per-scenario non-fatal handling: this CLI script must keep
 * writing `reports/capacity-report.{md,json}` and exiting successfully
 * even when the database is unreachable or `prisma generate` hasn't been
 * run in this environment — a load-testing/capacity-planning tool that
 * refused to produce its report just because optional persistence failed
 * would defeat the point of running it in CI at all. A warning is logged
 * either way so the gap is visible, never silent.
 *
 * ## Why there's also a process-level `unhandledRejection` handler below
 * The shared Prisma client (`infrastructure/database/prisma/client.ts`,
 * used by every Prisma-backed module, not just this one) lazily bootstraps
 * its native query engine the first time any *valid* model delegate is
 * touched, as a detached background promise separate from whatever
 * `await`ed call site triggered it. In an environment where that engine
 * binary can't be resolved (e.g. this sandbox: a locally cached
 * `darwin-arm64` engine but a `linux-arm64` runtime, with no network
 * access to fetch the matching one — the same root cause already noted
 * for `prisma generate`/`prisma migrate status` failing here), that
 * detached promise rejects on its own schedule, outside of and later than
 * the try/catch blocks in `main()` below. Node's default
 * `unhandledRejection` behavior is to crash the process, which would
 * silently defeat every non-fatal-persistence guarantee this script
 * documents — including, worst case, truncating a report file that was
 * mid-write when the rejection happened to surface. This handler is the
 * single place that guarantee is actually enforced end-to-end: log a
 * warning and keep running, never crash. It only ever WARNs; it never
 * suppresses a bug in `main()` itself, because a thrown error inside an
 * `await`ed call in `main()` surfaces through `main().catch()` below, not
 * through this handler.
 */
process.on("unhandledRejection", (reason) => {
  console.warn("capacity-report: an unhandled background rejection occurred (likely the shared Prisma client's engine bootstrap failing in this environment) — continuing without persistence.", reason);
});
async function main(): Promise<void> {
  const useCase = getGenerateCapacityReportUseCase();
  const scenarioById = new Map(PERFORMANCE_SCENARIO_CATALOG.map((scenario) => [scenario.id, scenario]));

  const { report, results } = await useCase.execute();

  const markdown = renderMarkdownReport(report, results, scenarioById);
  const json = toJsonReport(report, results, scenarioById);

  const reportsDir = path.resolve(process.cwd(), "reports");
  await mkdir(reportsDir, { recursive: true });

  const mdPath = path.join(reportsDir, "capacity-report.md");
  const jsonPath = path.join(reportsDir, "capacity-report.json");
  await writeFile(mdPath, markdown, "utf8");
  await writeFile(jsonPath, JSON.stringify(json, null, 2), "utf8");

  try {
    await getPersistCapacityReportUseCase().execute({ report, results, reportMarkdown: markdown, reportJson: json });
  } catch (error) {
    console.warn("capacity-report: failed to persist the report-anchoring LoadTestRun — files were still written to reports/.", error);
  }

  console.log(`MaestroYa Capacity Report`);
  console.log(`Overall Score: ${report.productionReadinessScore} / 100`);
  console.log(`Production Ready: ${report.isProductionReady ? "YES" : "NO"}`);
  console.log(`Scenarios evaluated: ${results.length} / ${PERFORMANCE_SCENARIO_CATALOG.length}`);
  console.log(`Bottlenecks: ${report.bottlenecks.length}`);
  console.log(`Written: ${mdPath}`);
  console.log(`Written: ${jsonPath}`);
}

main().catch((error: unknown) => {
  console.error("capacity-report failed:", error);
  process.exitCode = 1;
});
