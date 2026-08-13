import { describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/database/prisma/client", () => ({
  prisma: {
    loadTestRun: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

const executedAt = new Date("2026-06-01T00:10:00.000Z");
const row = {
  id: "run-1",
  scenarioId: "authentication",
  scenarioName: "Authentication",
  seed: 42,
  executedAt,
  durationMs: 10_000,
  totalRequests: 100,
  failedRequests: 2,
  timedOutRequests: 1,
  retriedRequests: 3,
  latencyAverageMs: 80,
  latencyMedianMs: 75,
  latencyP95Ms: 150,
  latencyP99Ms: 200,
  latencyMinMs: 10,
  latencyMaxMs: 250,
  requestsPerSecond: 40,
  transactionsPerSecond: 39.2,
  cpuPercent: 12.5,
  memoryMB: 256,
  dbPoolUtilizationPercent: 15,
  cacheHitRatioPercent: 80,
  errorRate: 0.02,
  timeoutRate: 0.01,
  retryRate: 0.03,
  productionReadinessScore: null,
  bottlenecks: null,
  recommendations: null,
  reportJson: null,
  reportMarkdown: null,
  gitCommit: null,
  gitBranch: null,
  appVersion: null,
  environment: null,
  createdAt: executedAt,
};

describe("infrastructure/database/prisma/repositories/prisma-load-test-result-repository", () => {
  it("maps a Prisma row to a COMPLETED LoadTestResult, rehydrating LatencyStatistics without any raw sample array", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    (prisma as unknown as { loadTestRun: { findUnique: ReturnType<typeof vi.fn> } }).loadTestRun.findUnique.mockResolvedValue(row);

    const { PrismaLoadTestResultRepository } = await import("@/infrastructure/database/prisma/repositories/prisma-load-test-result-repository");
    const result = await new PrismaLoadTestResultRepository().findById("run-1");

    expect(result).not.toBeNull();
    expect(result!.status).toBe("COMPLETED");
    expect(result!.scenarioId).toBe("authentication");
    expect(result!.seed).toBe(42);
    expect(result!.latency!.p95).toBe(150);
    expect(result!.latency!.sampleCount).toBe(100);
    expect(result!.throughput!.requestsPerSecond).toBe(40);
    expect(result!.resourceEstimate!.cacheHitRatioPercent).toBe(80);
    expect(result!.totalRequests).toBe(100);
    expect(result!.failedRequests).toBe(2);
  });

  it("returns null when no row is found", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    (prisma as unknown as { loadTestRun: { findUnique: ReturnType<typeof vi.fn> } }).loadTestRun.findUnique.mockResolvedValue(null);

    const { PrismaLoadTestResultRepository } = await import("@/infrastructure/database/prisma/repositories/prisma-load-test-result-repository");
    expect(await new PrismaLoadTestResultRepository().findById("missing")).toBeNull();
  });

  it("save() upserts the aggregated metrics of a COMPLETED result, with report-snapshot fields null when omitted", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    const upsert = vi.fn().mockResolvedValue(row);
    (prisma as unknown as { loadTestRun: { upsert: ReturnType<typeof vi.fn> } }).loadTestRun.upsert = upsert;

    const { PrismaLoadTestResultRepository } = await import("@/infrastructure/database/prisma/repositories/prisma-load-test-result-repository");
    const { LoadTestResult } = await import("@/domain/entities/load-test-result");
    const { LatencyStatistics } = await import("@/domain/value-objects/latency-distribution");

    const t0 = new Date("2026-06-01T00:00:00.000Z");
    const result = LoadTestResult.schedule("run-2", "authentication", 7, t0);
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
      executedAt,
    );

    await new PrismaLoadTestResultRepository().save(result, "Authentication");

    expect(upsert).toHaveBeenCalledTimes(1);
    const firstCall = upsert.mock.calls.at(0);
    if (!firstCall) throw new Error("Expected upsert to have been called.");
    expect(firstCall[0].create.scenarioId).toBe("authentication");
    expect(firstCall[0].create.seed).toBe(7);
    expect(firstCall[0].create.productionReadinessScore).toBeNull();
    expect(firstCall[0].create.bottlenecks).toBeUndefined();
    expect(firstCall[0].create.reportMarkdown).toBeNull();
  });

  it("save() carries the report snapshot (bottlenecks/recommendations/score/markdown/json) when supplied", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    const upsert = vi.fn().mockResolvedValue(row);
    (prisma as unknown as { loadTestRun: { upsert: ReturnType<typeof vi.fn> } }).loadTestRun.upsert = upsert;

    const { PrismaLoadTestResultRepository } = await import("@/infrastructure/database/prisma/repositories/prisma-load-test-result-repository");
    const { LoadTestResult } = await import("@/domain/entities/load-test-result");
    const { CapacityRecommendation } = await import("@/domain/entities/capacity-report");
    const { LatencyStatistics } = await import("@/domain/value-objects/latency-distribution");

    const t0 = new Date("2026-06-01T00:00:00.000Z");
    const result = LoadTestResult.schedule("run-3", "CAPACITY_REPORT", null, t0);
    result.markRunning(t0);
    result.markCompleted(
      {
        latency: LatencyStatistics.fromSamples([10, 20, 30]),
        throughput: { requestsPerSecond: 10, transactionsPerSecond: 10 },
        resourceEstimate: { cpuPercent: 5, memoryMB: 200, dbConnectionPoolUtilizationPercent: 5, cacheHitRatioPercent: 50 },
        totalRequests: 3,
        failedRequests: 0,
        timedOutRequests: 0,
        retriedRequests: 0,
      },
      executedAt,
    );

    await new PrismaLoadTestResultRepository().save(
      result,
      "Full Capacity Report (all scenarios)",
      {
        bottlenecks: [{ scenarioId: "search", scenarioName: "Search", p95LatencyMs: 1200, errorRate: 0.1, reason: "slow" }],
        recommendations: [new CapacityRecommendation("HORIZONTAL_INSTANCES", "scale out", "HIGH")],
        productionReadinessScore: 62,
        reportJson: { overallScore: 62 },
        reportMarkdown: "# Report",
      },
      { gitCommit: "abc123", gitBranch: "main", appVersion: "0.1.0", environment: "test" },
    );

    const firstCall = upsert.mock.calls.at(0);
    if (!firstCall) throw new Error("Expected upsert to have been called.");
    expect(firstCall[0].create.productionReadinessScore).toBe(62);
    expect(firstCall[0].create.bottlenecks).toEqual([{ scenarioId: "search", scenarioName: "Search", p95LatencyMs: 1200, errorRate: 0.1, reason: "slow" }]);
    expect(firstCall[0].create.recommendations).toEqual([{ category: "HORIZONTAL_INSTANCES", description: "scale out", urgency: "HIGH" }]);
    expect(firstCall[0].create.reportMarkdown).toBe("# Report");
    expect(firstCall[0].create.gitCommit).toBe("abc123");
  });

  it("throws when saving a non-COMPLETED result", async () => {
    const { PrismaLoadTestResultRepository } = await import("@/infrastructure/database/prisma/repositories/prisma-load-test-result-repository");
    const { LoadTestResult } = await import("@/domain/entities/load-test-result");

    const t0 = new Date("2026-06-01T00:00:00.000Z");
    const result = LoadTestResult.schedule("run-4", "authentication", null, t0);

    await expect(new PrismaLoadTestResultRepository().save(result, "Authentication")).rejects.toThrow();
  });

  it("findLatestByScenario orders by executedAt desc", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    const findFirst = vi.fn().mockResolvedValue(row);
    (prisma as unknown as { loadTestRun: { findFirst: ReturnType<typeof vi.fn> } }).loadTestRun.findFirst = findFirst;

    const { PrismaLoadTestResultRepository } = await import("@/infrastructure/database/prisma/repositories/prisma-load-test-result-repository");
    await new PrismaLoadTestResultRepository().findLatestByScenario("authentication");

    expect(findFirst).toHaveBeenCalledWith({ where: { scenarioId: "authentication" }, orderBy: { executedAt: "desc" } });
  });

  it("findRecentByScenario limits and orders by executedAt desc", async () => {
    const { prisma } = await import("@/infrastructure/database/prisma/client");
    const findMany = vi.fn().mockResolvedValue([row]);
    (prisma as unknown as { loadTestRun: { findMany: ReturnType<typeof vi.fn> } }).loadTestRun.findMany = findMany;

    const { PrismaLoadTestResultRepository } = await import("@/infrastructure/database/prisma/repositories/prisma-load-test-result-repository");
    const results = await new PrismaLoadTestResultRepository().findRecentByScenario("authentication", 5);

    expect(findMany).toHaveBeenCalledWith({ where: { scenarioId: "authentication" }, orderBy: { executedAt: "desc" }, take: 5 });
    expect(results).toHaveLength(1);
  });
});
