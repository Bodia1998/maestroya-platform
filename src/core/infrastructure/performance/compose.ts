import "server-only";

import { randomUUID } from "node:crypto";

import type { LoadTestExecutor } from "@/application/ports/load-test-executor";
import { BaselineComparisonService } from "@/application/services/performance/baseline-comparison-service";
import { CapacityPlanningService } from "@/application/services/performance/capacity-planning-service";
import { LoadTestingService } from "@/application/services/performance/load-testing-service";
import { PerformanceAnalysisService } from "@/application/services/performance/performance-analysis-service";
import { ComparePerformanceBaselineUseCase } from "@/application/use-cases/performance/compare-performance-baseline.use-case";
import { DetectPerformanceRegressionUseCase } from "@/application/use-cases/performance/detect-performance-regression.use-case";
import { ExecuteLoadTestUseCase } from "@/application/use-cases/performance/execute-load-test.use-case";
import { GenerateCapacityReportUseCase } from "@/application/use-cases/performance/generate-capacity-report.use-case";
import { PersistCapacityReportUseCase } from "@/application/use-cases/performance/persist-capacity-report.use-case";
import { PrismaLoadTestResultRepository } from "@/infrastructure/database/prisma/repositories/prisma-load-test-result-repository";
import { PrismaPerformanceBaselineRepository } from "@/infrastructure/database/prisma/repositories/prisma-performance-baseline-repository";
import { BenchmarkRunner } from "@/infrastructure/performance/benchmark-runner";
import { resolvePerformanceConfig } from "@/infrastructure/performance/performance-config";
import { resolveRuntimeMetadata } from "@/infrastructure/performance/runtime-metadata";

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * Composition root — the same manual, no-DI-container convention as every
 * other `compose.ts` in this codebase. Structurally still simpler than
 * `infrastructure/backup/compose.ts`: there is no queue, worker, or
 * scheduler — a load test is an in-process simulation triggered on demand
 * (by an operator, a CI/release-readiness step, or the `npm run
 * capacity-report` CLI script), never long-running background machinery.
 *
 * ## Persistence — restored, aggregated only
 * This module *does* hold a persistence dependency again, after a prior
 * refactor pass stripped it out entirely: `repository`
 * (`PrismaLoadTestResultRepository`) and `baselineRepository`
 * (`PrismaPerformanceBaselineRepository`) are constructed as module-scope
 * singletons here, exactly like `infrastructure/backup/compose.ts`'s own
 * `repository`. Only already-aggregated `LoadTestResult`/
 * `PerformanceBaseline` data is ever persisted through them — a
 * `LoadTestResult` already only ever holds computed `LatencyStatistics`
 * (six numbers), never a raw per-request sample array, so there is no
 * separate "strip the raw data" step anywhere in this wiring; the
 * aggregate the domain layer already produces *is* what gets saved. Every
 * use case below remains fully constructible and functional with the
 * database unavailable — `GenerateCapacityReportUseCase`/
 * `PersistCapacityReportUseCase` catch and log persistence failures
 * rather than letting them fail a report (see those use cases' own doc
 * comments), so `npm run capacity-report` still produces
 * `reports/capacity-report.{md,json}` even without a configured database.
 *
 * ## `LOAD_TEST_ENABLED=false` (the default)
 * Every use case below is still constructible and functional regardless
 * of this flag — it is consulted only as a kill switch an operator can
 * flip without a deploy for whatever CI step invokes the CLI, the same
 * role `BACKUP_ENABLED` plays for Module 54's route/health surface;
 * nothing here runs "just because" a process started.
 */

const capacityPlanning = new CapacityPlanningService();
const analysis = new PerformanceAnalysisService();
const repository = new PrismaLoadTestResultRepository();
const baselineRepository = new PrismaPerformanceBaselineRepository();

let executor: LoadTestExecutor | null = null;

function getExecutor(): LoadTestExecutor {
  if (!executor) {
    executor = new BenchmarkRunner();
  }
  return executor;
}

function getComparisonService(): BaselineComparisonService {
  const config = resolvePerformanceConfig();
  return new BaselineComparisonService(config.regressionThresholds);
}

function getLoadTestingService(): LoadTestingService {
  return new LoadTestingService({
    executor: getExecutor(),
    generateId: randomUUID,
    now: () => new Date(),
  });
}

export function getExecuteLoadTestUseCase(): ExecuteLoadTestUseCase {
  return new ExecuteLoadTestUseCase(getLoadTestingService());
}

export function getComparePerformanceBaselineUseCase(): ComparePerformanceBaselineUseCase {
  return new ComparePerformanceBaselineUseCase({
    comparisonService: getComparisonService(),
    now: () => new Date(),
    baselineRepository,
  });
}

export function getDetectPerformanceRegressionUseCase(): DetectPerformanceRegressionUseCase {
  return new DetectPerformanceRegressionUseCase({
    comparisonService: getComparisonService(),
    now: () => new Date(),
    resultRepository: repository,
    baselineRepository,
  });
}

export function getGenerateCapacityReportUseCase(): GenerateCapacityReportUseCase {
  return new GenerateCapacityReportUseCase({
    loadTestingService: getLoadTestingService(),
    capacityPlanning,
    analysis,
    comparison: getComparisonService(),
    generateId: randomUUID,
    now: () => new Date(),
    resultRepository: repository,
    baselineRepository,
  });
}

export function getPersistCapacityReportUseCase(): PersistCapacityReportUseCase {
  return new PersistCapacityReportUseCase({
    resultRepository: repository,
    generateId: randomUUID,
    now: () => new Date(),
    resolveMetadata: resolveRuntimeMetadata,
  });
}

/** Exposed for tests only — drops every lazily-constructed singleton so the next call rebuilds. Mirrors `infrastructure/backup/compose.ts`'s own `__testing.reset()`. */
export const __testing = {
  reset(): void {
    executor = null;
  },
};
