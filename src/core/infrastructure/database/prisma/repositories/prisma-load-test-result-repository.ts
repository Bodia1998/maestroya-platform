import type { LoadTestRun as PrismaLoadTestRunRow } from "@prisma/client";

import type { CapacityRecommendation } from "@/domain/entities/capacity-report";
import { LoadTestResult } from "@/domain/entities/load-test-result";
import type {
  LoadTestResultRepository,
  LoadTestRunMetadata,
  LoadTestRunReportSnapshot,
} from "@/domain/repositories/load-test-result-repository";
import { LatencyStatistics } from "@/domain/value-objects/latency-distribution";
import { prisma } from "@/infrastructure/database/prisma/client";

/**
 * Module 57 — Load Testing & Capacity Planning: Prisma-backed
 * `LoadTestResultRepository`. Maps between the `LoadTestResult` aggregate
 * and the `load_test_runs` table row — the only place either direction of
 * that mapping happens, mirroring `PrismaBackupRecordRepository`.
 *
 * Only `COMPLETED` results with a full metric set are ever persisted —
 * `save()` throws for anything else, the same "refuse at the boundary
 * rather than silently write partial/meaningless data" convention
 * `PerformanceBaseline.capture()` already establishes for this module. A
 * `PENDING`/`RUNNING`/`FAILED` `LoadTestResult` carries no aggregated
 * metrics worth keeping — a caller that wants to know a run failed reads
 * that off the in-memory result the same run/report call already
 * returned, not a persisted row.
 */
export class PrismaLoadTestResultRepository implements LoadTestResultRepository {
  async save(
    result: LoadTestResult,
    scenarioName: string,
    reportSnapshot: LoadTestRunReportSnapshot = {},
    metadata: LoadTestRunMetadata = {},
  ): Promise<void> {
    if (result.status !== "COMPLETED" || !result.latency || !result.throughput || !result.resourceEstimate || !result.startedAt || !result.completedAt) {
      throw new Error(
        `PrismaLoadTestResultRepository.save requires a COMPLETED LoadTestResult with full metrics and timestamps; result ${result.id} is ${result.status}.`,
      );
    }

    const durationMs = Math.max(0, result.completedAt.getTime() - result.startedAt.getTime());

    const data = {
      scenarioId: result.scenarioId,
      scenarioName,
      seed: result.seed,
      executedAt: result.completedAt,
      durationMs,
      totalRequests: result.totalRequests,
      failedRequests: result.failedRequests,
      timedOutRequests: result.timedOutRequests,
      retriedRequests: result.retriedRequests,
      latencyAverageMs: result.latency.average,
      latencyMedianMs: result.latency.median,
      latencyP95Ms: result.latency.p95,
      latencyP99Ms: result.latency.p99,
      latencyMinMs: result.latency.min,
      latencyMaxMs: result.latency.max,
      requestsPerSecond: result.throughput.requestsPerSecond,
      transactionsPerSecond: result.throughput.transactionsPerSecond,
      cpuPercent: result.resourceEstimate.cpuPercent,
      memoryMB: result.resourceEstimate.memoryMB,
      dbPoolUtilizationPercent: result.resourceEstimate.dbConnectionPoolUtilizationPercent,
      cacheHitRatioPercent: result.resourceEstimate.cacheHitRatioPercent,
      errorRate: result.errorRate,
      timeoutRate: result.timeoutRate,
      retryRate: result.retryRate,
      productionReadinessScore: reportSnapshot.productionReadinessScore ?? null,
      bottlenecks: toJson(reportSnapshot.bottlenecks),
      recommendations: toJson(reportSnapshot.recommendations?.map(recommendationToPlain)),
      reportJson: toJson(reportSnapshot.reportJson),
      reportMarkdown: reportSnapshot.reportMarkdown ?? null,
      gitCommit: metadata.gitCommit ?? null,
      gitBranch: metadata.gitBranch ?? null,
      appVersion: metadata.appVersion ?? null,
      environment: metadata.environment ?? null,
    };

    await prisma.loadTestRun.upsert({
      where: { id: result.id },
      create: { id: result.id, ...data },
      update: data,
    });
  }

  async findById(id: string): Promise<LoadTestResult | null> {
    const row = await prisma.loadTestRun.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findRecentByScenario(scenarioId: string, limit: number): Promise<LoadTestResult[]> {
    const rows = await prisma.loadTestRun.findMany({
      where: { scenarioId },
      orderBy: { executedAt: "desc" },
      take: limit,
    });
    return rows.map(toDomain);
  }

  async findLatestByScenario(scenarioId: string): Promise<LoadTestResult | null> {
    const row = await prisma.loadTestRun.findFirst({
      where: { scenarioId },
      orderBy: { executedAt: "desc" },
    });
    return row ? toDomain(row) : null;
  }
}

/** `undefined`/empty input maps to `undefined` (Prisma: "leave this field alone / default"), never an empty JSON value that would look like a real, deliberately-empty snapshot. `JSON.parse(JSON.stringify(...))` strips any class-instance prototype so only plain, JSON-serializable data ever reaches the Json column — the same defensive boundary as everywhere else this module refuses to persist anything but computed aggregates. */
function toJson(value: unknown): object | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as object;
}

function recommendationToPlain(recommendation: CapacityRecommendation): { category: string; description: string; urgency: string } {
  return { category: recommendation.category, description: recommendation.description, urgency: recommendation.urgency };
}

function toDomain(row: PrismaLoadTestRunRow): LoadTestResult {
  const startedAt = new Date(row.executedAt.getTime() - row.durationMs);

  const latency = LatencyStatistics.rehydrate({
    sampleCount: row.totalRequests,
    min: row.latencyMinMs,
    max: row.latencyMaxMs,
    average: row.latencyAverageMs,
    median: row.latencyMedianMs,
    p95: row.latencyP95Ms,
    p99: row.latencyP99Ms,
  });

  return LoadTestResult.rehydrate({
    id: row.id,
    scenarioId: row.scenarioId,
    seed: row.seed,
    status: "COMPLETED",
    scheduledAt: startedAt,
    startedAt,
    completedAt: row.executedAt,
    latency,
    throughput: { requestsPerSecond: row.requestsPerSecond, transactionsPerSecond: row.transactionsPerSecond },
    resourceEstimate: {
      cpuPercent: row.cpuPercent,
      memoryMB: row.memoryMB,
      dbConnectionPoolUtilizationPercent: row.dbPoolUtilizationPercent,
      cacheHitRatioPercent: row.cacheHitRatioPercent,
    },
    totalRequests: row.totalRequests,
    failedRequests: row.failedRequests,
    timedOutRequests: row.timedOutRequests,
    retriedRequests: row.retriedRequests,
    failureReason: null,
  });
}
