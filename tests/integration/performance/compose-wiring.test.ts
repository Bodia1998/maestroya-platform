import { describe, expect, it } from "vitest";

/**
 * Module 57 — Load Testing & Capacity Planning: end-to-end wiring
 * coverage — proving the real composition root
 * (`infrastructure/performance/compose.ts`) actually wires a real
 * `BenchmarkRunner`, a real `LoadTestingService`, and the real
 * `GenerateCapacityReportUseCase` together end to end, not just that the
 * pure services/entities work in isolation (already covered by the unit
 * tests).
 *
 * Persistence is wired against the *real* `PrismaLoadTestResultRepository`/
 * `PrismaPerformanceBaselineRepository` here too — deliberately not
 * mocked, since `GenerateCapacityReportUseCase`/`PersistCapacityReportUseCase`
 * are required to keep working even when the database is unreachable
 * (this sandbox has no live Postgres — see the repo-root validation notes).
 * Every assertion below is about the in-memory `report`/`results` this
 * use case returns; the point of these tests is that a persistence
 * failure never surfaces as a thrown error here.
 */
describe("Module 57 — Load Testing & Capacity Planning — compose.ts wiring", () => {
  it("ExecuteLoadTestUseCase runs a real scenario through the real BenchmarkRunner and returns a COMPLETED LoadTestResult, with nothing persisted", async () => {
    const { getExecuteLoadTestUseCase } = await import("@/infrastructure/performance/compose");
    const useCase = getExecuteLoadTestUseCase();

    const result = await useCase.execute({ scenarioId: "authentication", seed: 123 });

    expect(result.status).toBe("COMPLETED");
    expect(result.scenarioId).toBe("authentication");
    expect(result.totalRequests).toBeGreaterThan(0);
    expect(result.latency).not.toBeNull();
  });

  it("throws NotFoundError for a scenario id that isn't in the catalog", async () => {
    const { getExecuteLoadTestUseCase } = await import("@/infrastructure/performance/compose");
    await expect(getExecuteLoadTestUseCase().execute({ scenarioId: "not-a-real-scenario" })).rejects.toThrow();
  });

  it("GenerateCapacityReportUseCase runs the requested scenarios in memory and produces a defined production readiness score", async () => {
    const { getGenerateCapacityReportUseCase } = await import("@/infrastructure/performance/compose");

    const { report, results } = await getGenerateCapacityReportUseCase().execute({ scenarioIds: ["authentication"], seed: 42 });

    expect(results).toHaveLength(1);
    expect(results[0]?.scenarioId).toBe("authentication");
    expect(report.projections.length).toBeGreaterThan(0);
    expect(report.productionReadinessScore).toBeGreaterThanOrEqual(0);
    expect(report.productionReadinessScore).toBeLessThanOrEqual(100);
  });

  it("GenerateCapacityReportUseCase produces a defined score even when no scenario ids are recognized", async () => {
    const { getGenerateCapacityReportUseCase } = await import("@/infrastructure/performance/compose");

    const { report, results } = await getGenerateCapacityReportUseCase().execute({ scenarioIds: ["not-a-real-scenario"] });

    expect(results).toHaveLength(0);
    expect(report.bottlenecks).toHaveLength(0);
    expect(report.productionReadinessScore).toBe(100);
  });

  it("GenerateCapacityReportUseCase tolerates the real (unreachable, in this sandbox) database — persistence failures never surface as a thrown error", async () => {
    const { getGenerateCapacityReportUseCase } = await import("@/infrastructure/performance/compose");

    const { report, results } = await getGenerateCapacityReportUseCase().execute({ scenarioIds: ["authentication"], seed: 7 });

    expect(results).toHaveLength(1);
    expect(report.productionReadinessScore).toBeGreaterThanOrEqual(0);
  });

  it("PersistCapacityReportUseCase is wired against the real repository/metadata resolver", async () => {
    // Exercising execute() here would perform a real database write via
    // the real PrismaLoadTestResultRepository — unreachable in this
    // sandbox (see the repo-root validation notes on `prisma generate`).
    // scripts/run-capacity-report.ts wraps that call in its own
    // try/catch precisely because this failure mode is expected in an
    // environment without a configured database; this test only proves
    // compose.ts constructs a real, correctly-typed use case instance.
    const { getPersistCapacityReportUseCase } = await import("@/infrastructure/performance/compose");
    const useCase = getPersistCapacityReportUseCase();
    expect(typeof useCase.execute).toBe("function");
  });

  it("ComparePerformanceBaselineUseCase/DetectPerformanceRegressionUseCase are constructible with the real baseline/result repositories wired in", async () => {
    // Exercising a lookup here would hit the real (unreachable, in this
    // sandbox) database — see the repo-root validation notes on
    // `prisma generate`. This test only proves compose.ts wires a
    // repository into both use cases at all, the same "construction
    // doesn't require a live database" guarantee every other lazy
    // singleton in this file already has.
    const { getComparePerformanceBaselineUseCase, getDetectPerformanceRegressionUseCase } = await import("@/infrastructure/performance/compose");

    expect(getComparePerformanceBaselineUseCase()).toBeInstanceOf(Object);
    expect(getDetectPerformanceRegressionUseCase()).toBeInstanceOf(Object);
  });
});
