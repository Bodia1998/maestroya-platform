import { describe, expect, it, vi } from "vitest";

import { createReconciliationRunJobProcessor } from "@/infrastructure/reconciliation/reconciliation-job-processor";
import type { StartReconciliationRunUseCase, ReconciliationRunSummary } from "@/application/use-cases/reconciliation/start-reconciliation-run.use-case";
import type { ActiveJob } from "@/infrastructure/jobs/job-types";
import type { ReconciliationRunJobData } from "@/infrastructure/reconciliation/reconciliation-jobs";
import type { ReconciliationRunRecord } from "@/domain/repositories/reconciliation-repository";

function baseRun(overrides: Partial<ReconciliationRunRecord> = {}): ReconciliationRunRecord {
  return {
    id: "run-1",
    scope: "FULL",
    status: "COMPLETED",
    startedAt: new Date("2026-08-31T00:00:00Z"),
    completedAt: new Date("2026-08-31T00:00:05Z"),
    durationMs: 5000,
    recordsInspected: 10,
    discrepancyCount: 0,
    errorMessage: null,
    parametersHash: "abc123",
    triggeredByUserId: null,
    createdAt: new Date("2026-08-31T00:00:00Z"),
    ...overrides,
  };
}

function makeJob(): ActiveJob<ReconciliationRunJobData> {
  return {
    id: "job-1",
    queue: "reconciliation-run",
    name: "reconciliation.run",
    data: { scope: "FULL", limit: 500, reason: "scheduled" },
    attempt: 1,
    maxAttempts: 3,
  };
}

describe("infrastructure/reconciliation/reconciliation-job-processor", () => {
  it("resolves without throwing when the run completes (with or without discrepancies)", async () => {
    const execute = vi.fn(
      async (): Promise<ReconciliationRunSummary> => ({
        run: baseRun({ discrepancyCount: 2 }),
        discrepanciesCreated: 1,
        discrepanciesReconfirmed: 1,
      }),
    );
    const useCase = { execute } as unknown as StartReconciliationRunUseCase;
    const processor = createReconciliationRunJobProcessor(useCase);

    await expect(processor(makeJob())).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledWith({ scope: "FULL", limit: 500 }, null);
  });

  it("throws when the reconciliation run itself is FAILED, so the job layer retries/dead-letters it", async () => {
    const execute = vi.fn(
      async (): Promise<ReconciliationRunSummary> => ({
        run: baseRun({ status: "FAILED", errorMessage: "data source unavailable", completedAt: new Date() }),
        discrepanciesCreated: 0,
        discrepanciesReconfirmed: 0,
      }),
    );
    const useCase = { execute } as unknown as StartReconciliationRunUseCase;
    const processor = createReconciliationRunJobProcessor(useCase);

    await expect(processor(makeJob())).rejects.toThrow(/data source unavailable/);
  });

  it("calls the use case exactly once per attempt — this processor is not a second reconciliation engine", async () => {
    const execute = vi.fn(
      async (): Promise<ReconciliationRunSummary> => ({
        run: baseRun({ status: "FAILED", errorMessage: "boom" }),
        discrepanciesCreated: 0,
        discrepanciesReconfirmed: 0,
      }),
    );
    const useCase = { execute } as unknown as StartReconciliationRunUseCase;
    const processor = createReconciliationRunJobProcessor(useCase);

    await expect(processor(makeJob())).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
