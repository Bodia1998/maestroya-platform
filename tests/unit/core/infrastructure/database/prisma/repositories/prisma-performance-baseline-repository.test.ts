import { describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/database/prisma/client", () => ({
  prisma: {
    performanceBaseline: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

const capturedAt = new Date("2026-06-01T00:00:00.000Z");
const row = {
  id: "baseline-1",
  scenarioId: "authentication",
  label: "pre-release",
  capturedAt,
  sourceRunId: "run-1",
  sampleCount: 5,
  latencyAverageMs: 80,
  latencyMedianMs: 75,
  latencyP95Ms: 150,
  latencyP99Ms: 200,
  latencyMinMs: 10,
  latencyMaxMs: 250,
  requestsPerSecond: 40,
  transactionsPerSecond: 39,
  cpuPercent: 5,
  memoryMB: 200,
  dbPoolUtilizationPercent: 5,
  cacheHitRatioPercent: 50,
  errorRate: 0.01,
  createdAt: capturedAt,
  updatedAt: capturedAt,
};

describe("infrastructure/database/prisma/repositories/prisma-performance-baseline-repository", () => {
  it("maps a Prisma row to a PerformanceBaseline", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    (prisma as unknown as { performanceBaseline: { findFirst: ReturnType<typeof vi.fn> } }).performanceBaseline.findFirst.mockResolvedValue(row);

    const { PrismaPerformanceBaselineRepository } = await import("@/infrastructure/database/prisma/repositories/prisma-performance-baseline-repository");
    const baseline = await new PrismaPerformanceBaselineRepository().findLatestByScenario("authentication");

    expect(baseline).not.toBeNull();
    expect(baseline!.label).toBe("pre-release");
    expect(baseline!.latency.p95).toBe(150);
    expect(baseline!.throughput.requestsPerSecond).toBe(40);
    expect(baseline!.resourceEstimate.cacheHitRatioPercent).toBe(50);
    expect(baseline!.errorRate).toBe(0.01);
  });

  it("returns null when no row is found", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    (prisma as unknown as { performanceBaseline: { findUnique: ReturnType<typeof vi.fn> } }).performanceBaseline.findUnique.mockResolvedValue(null);

    const { PrismaPerformanceBaselineRepository } = await import("@/infrastructure/database/prisma/repositories/prisma-performance-baseline-repository");
    expect(await new PrismaPerformanceBaselineRepository().findByScenarioAndLabel("authentication", "missing")).toBeNull();
  });

  it("save() upserts on the (scenarioId, label) unique constraint", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    const upsert = vi.fn().mockResolvedValue(row);
    (prisma as unknown as { performanceBaseline: { upsert: ReturnType<typeof vi.fn> } }).performanceBaseline.upsert = upsert;

    const { PrismaPerformanceBaselineRepository } = await import("@/infrastructure/database/prisma/repositories/prisma-performance-baseline-repository");
    const { LoadTestResult } = await import("@/domain/entities/load-test-result");
    const { PerformanceBaseline } = await import("@/domain/entities/performance-baseline");
    const { LatencyStatistics } = await import("@/domain/value-objects/latency-distribution");

    const t0 = new Date("2026-06-01T00:00:00.000Z");
    const result = LoadTestResult.schedule("run-1", "authentication", null, t0);
    result.markRunning(t0);
    result.markCompleted(
      {
        latency: LatencyStatistics.fromSamples([10, 20, 30, 40, 50]),
        throughput: { requestsPerSecond: 40, transactionsPerSecond: 39 },
        resourceEstimate: { cpuPercent: 5, memoryMB: 200, dbConnectionPoolUtilizationPercent: 5, cacheHitRatioPercent: 50 },
        totalRequests: 5,
        failedRequests: 0,
        timedOutRequests: 0,
        retriedRequests: 0,
      },
      t0,
    );
    const baseline = PerformanceBaseline.capture("baseline-2", result, "pre-release", t0);

    await new PrismaPerformanceBaselineRepository().save(baseline);

    expect(upsert).toHaveBeenCalledTimes(1);
    const firstCall = upsert.mock.calls.at(0);
    if (!firstCall) throw new Error("Expected upsert to have been called.");
    expect(firstCall[0].where).toEqual({ scenarioId_label: { scenarioId: "authentication", label: "pre-release" } });
    expect(firstCall[0].create.sourceRunId).toBe("run-1");
    expect(firstCall[0].create.sampleCount).toBe(5);
  });

  it("list() orders by capturedAt desc", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    const findMany = vi.fn().mockResolvedValue([row]);
    (prisma as unknown as { performanceBaseline: { findMany: ReturnType<typeof vi.fn> } }).performanceBaseline.findMany = findMany;

    const { PrismaPerformanceBaselineRepository } = await import("@/infrastructure/database/prisma/repositories/prisma-performance-baseline-repository");
    const baselines = await new PrismaPerformanceBaselineRepository().list("authentication");

    expect(findMany).toHaveBeenCalledWith({ where: { scenarioId: "authentication" }, orderBy: { capturedAt: "desc" } });
    expect(baselines).toHaveLength(1);
  });
});
