import type { PerformanceBaseline as PrismaPerformanceBaselineRow } from "@prisma/client";

import { PerformanceBaseline } from "@/domain/entities/performance-baseline";
import type { PerformanceBaselineRepository } from "@/domain/repositories/performance-baseline-repository";
import { LatencyStatistics } from "@/domain/value-objects/latency-distribution";
import { prisma } from "@/infrastructure/database/prisma/client";

/**
 * Module 57 — Load Testing & Capacity Planning: Prisma-backed
 * `PerformanceBaselineRepository`. Maps between the `PerformanceBaseline`
 * entity and the `performance_baselines` table row — the only place
 * either direction of that mapping happens, mirroring
 * `PrismaBackupRecordRepository`. `save()` upserts on the table's
 * `(scenarioId, label)` unique constraint: capturing a baseline under a
 * label that already exists for the scenario replaces it, matching
 * `PerformanceBaselineRepository.save`'s own documented contract.
 */
export class PrismaPerformanceBaselineRepository implements PerformanceBaselineRepository {
  async save(baseline: PerformanceBaseline): Promise<void> {
    const data = {
      scenarioId: baseline.scenarioId,
      label: baseline.label,
      capturedAt: baseline.capturedAt,
      sourceRunId: baseline.sourceResultId,
      sampleCount: baseline.latency.sampleCount,
      latencyAverageMs: baseline.latency.average,
      latencyMedianMs: baseline.latency.median,
      latencyP95Ms: baseline.latency.p95,
      latencyP99Ms: baseline.latency.p99,
      latencyMinMs: baseline.latency.min,
      latencyMaxMs: baseline.latency.max,
      requestsPerSecond: baseline.throughput.requestsPerSecond,
      transactionsPerSecond: baseline.throughput.transactionsPerSecond,
      cpuPercent: baseline.resourceEstimate.cpuPercent,
      memoryMB: baseline.resourceEstimate.memoryMB,
      dbPoolUtilizationPercent: baseline.resourceEstimate.dbConnectionPoolUtilizationPercent,
      cacheHitRatioPercent: baseline.resourceEstimate.cacheHitRatioPercent,
      errorRate: baseline.errorRate,
    };

    await prisma.performanceBaseline.upsert({
      where: { scenarioId_label: { scenarioId: baseline.scenarioId, label: baseline.label } },
      create: { id: baseline.id, ...data },
      update: data,
    });
  }

  async findByScenarioAndLabel(scenarioId: string, label: string): Promise<PerformanceBaseline | null> {
    const row = await prisma.performanceBaseline.findUnique({ where: { scenarioId_label: { scenarioId, label } } });
    return row ? toDomain(row) : null;
  }

  async findLatestByScenario(scenarioId: string): Promise<PerformanceBaseline | null> {
    const row = await prisma.performanceBaseline.findFirst({
      where: { scenarioId },
      orderBy: { capturedAt: "desc" },
    });
    return row ? toDomain(row) : null;
  }

  async list(scenarioId: string): Promise<PerformanceBaseline[]> {
    const rows = await prisma.performanceBaseline.findMany({
      where: { scenarioId },
      orderBy: { capturedAt: "desc" },
    });
    return rows.map(toDomain);
  }
}

function toDomain(row: PrismaPerformanceBaselineRow): PerformanceBaseline {
  return PerformanceBaseline.rehydrate({
    id: row.id,
    scenarioId: row.scenarioId,
    label: row.label,
    capturedAt: row.capturedAt,
    sourceResultId: row.sourceRunId,
    latency: LatencyStatistics.rehydrate({
      sampleCount: row.sampleCount,
      min: row.latencyMinMs,
      max: row.latencyMaxMs,
      average: row.latencyAverageMs,
      median: row.latencyMedianMs,
      p95: row.latencyP95Ms,
      p99: row.latencyP99Ms,
    }),
    throughput: { requestsPerSecond: row.requestsPerSecond, transactionsPerSecond: row.transactionsPerSecond },
    resourceEstimate: {
      cpuPercent: row.cpuPercent,
      memoryMB: row.memoryMB,
      dbConnectionPoolUtilizationPercent: row.dbPoolUtilizationPercent,
      cacheHitRatioPercent: row.cacheHitRatioPercent,
    },
    errorRate: row.errorRate,
  });
}
