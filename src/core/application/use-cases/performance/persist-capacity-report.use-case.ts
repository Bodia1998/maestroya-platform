import type { CapacityReport } from "@/domain/entities/capacity-report";
import { LoadTestResult } from "@/domain/entities/load-test-result";
import type { LoadTestResultRepository, LoadTestRunMetadata } from "@/domain/repositories/load-test-result-repository";
import { LatencyStatistics } from "@/domain/value-objects/latency-distribution";

export interface PersistCapacityReportInput {
  report: CapacityReport;
  /** The `LoadTestResult`s the report was built from — `GenerateCapacityReportUseCase`'s own return value. */
  results: readonly LoadTestResult[];
  /** The rendered Markdown, as produced by `infrastructure/performance/report-generator.ts`'s `renderMarkdownReport()`. */
  reportMarkdown: string;
  /** The structured JSON report, as produced by `report-generator.ts`'s `toJsonReport()` — a JSON-serializable snapshot, never raw samples. */
  reportJson: unknown;
}

export interface PersistCapacityReportDependencies {
  resultRepository: LoadTestResultRepository;
  generateId: () => string;
  now: () => Date;
  /** Resolves git commit/branch, app version, and environment — see `infrastructure/performance/runtime-metadata.ts`. Injected (rather than imported directly) so this use case stays free of infrastructure imports. */
  resolveMetadata: () => LoadTestRunMetadata;
}

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * Persists the single `LoadTestRun` row that anchors one full `npm run
 * capacity-report` invocation — distinct from the per-scenario rows
 * `GenerateCapacityReportUseCase` already saves as it runs each scenario.
 * A capacity report spans many scenarios, but `LoadTestRun.scenarioId` is
 * required (every row describes one scenario's worth of aggregated
 * metrics — see `prisma/schema.prisma`'s own doc comment), so this use
 * case builds one additional synthetic `LoadTestResult` — under the
 * reserved scenario id `"CAPACITY_REPORT"` — whose metrics are a
 * documented aggregation *of the already-aggregated per-scenario
 * results* (never raw samples, which no longer exist by this point
 * anyway): latency average/median are averaged across scenarios, p95/p99
 * take the worst (max) across scenarios (the figure that actually
 * determines whether the report as a whole is production-ready),
 * min/max take the overall min/max, throughput/request counts are
 * summed (aggregate load across every scenario), and CPU/DB-pool/cache
 * are averaged. That row alone carries `productionReadinessScore`,
 * `bottlenecks`, `recommendations`, `reportJson`, and `reportMarkdown` —
 * every other `LoadTestRun` row leaves those columns `null`.
 *
 * A no-op (not an error) when `results` is empty — a report with no
 * completed scenario evidence has nothing meaningful to anchor.
 */
export class PersistCapacityReportUseCase {
  constructor(private readonly deps: PersistCapacityReportDependencies) {}

  async execute(input: PersistCapacityReportInput): Promise<void> {
    const completed = input.results.filter(
      (result): result is LoadTestResult => result.status === "COMPLETED" && result.latency !== null && result.throughput !== null && result.resourceEstimate !== null,
    );
    if (completed.length === 0) return;

    const startedAt = completed.reduce<Date>((earliest, result) => {
      const candidate = result.startedAt ?? result.scheduledAt;
      return candidate < earliest ? candidate : earliest;
    }, completed[0]!.startedAt ?? completed[0]!.scheduledAt);

    const summary = LoadTestResult.schedule(this.deps.generateId(), "CAPACITY_REPORT", null, startedAt);
    summary.markRunning(startedAt);
    summary.markCompleted(
      {
        latency: LatencyStatistics.rehydrate({
          sampleCount: sumBy(completed, (r) => r.latency!.sampleCount),
          min: Math.min(...completed.map((r) => r.latency!.min)),
          max: Math.max(...completed.map((r) => r.latency!.max)),
          average: averageBy(completed, (r) => r.latency!.average),
          median: averageBy(completed, (r) => r.latency!.median),
          p95: Math.max(...completed.map((r) => r.latency!.p95)),
          p99: Math.max(...completed.map((r) => r.latency!.p99)),
        }),
        throughput: {
          requestsPerSecond: sumBy(completed, (r) => r.throughput!.requestsPerSecond),
          transactionsPerSecond: sumBy(completed, (r) => r.throughput!.transactionsPerSecond),
        },
        resourceEstimate: {
          cpuPercent: averageBy(completed, (r) => r.resourceEstimate!.cpuPercent),
          memoryMB: sumBy(completed, (r) => r.resourceEstimate!.memoryMB),
          dbConnectionPoolUtilizationPercent: averageBy(completed, (r) => r.resourceEstimate!.dbConnectionPoolUtilizationPercent),
          cacheHitRatioPercent: averageBy(completed, (r) => r.resourceEstimate!.cacheHitRatioPercent),
        },
        totalRequests: sumBy(completed, (r) => r.totalRequests),
        failedRequests: sumBy(completed, (r) => r.failedRequests),
        timedOutRequests: sumBy(completed, (r) => r.timedOutRequests),
        retriedRequests: sumBy(completed, (r) => r.retriedRequests),
      },
      input.report.generatedAt,
    );

    await this.deps.resultRepository.save(summary, "Full Capacity Report (all scenarios)", {
      bottlenecks: input.report.bottlenecks,
      recommendations: input.report.recommendations,
      productionReadinessScore: input.report.productionReadinessScore,
      reportJson: input.reportJson,
      reportMarkdown: input.reportMarkdown,
    }, this.deps.resolveMetadata());
  }
}

function sumBy<T>(items: readonly T[], selector: (item: T) => number): number {
  return items.reduce((total, item) => total + selector(item), 0);
}

function averageBy<T>(items: readonly T[], selector: (item: T) => number): number {
  return items.length === 0 ? 0 : sumBy(items, selector) / items.length;
}
