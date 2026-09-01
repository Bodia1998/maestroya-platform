import { describe, expect, it, vi } from "vitest";

import { createReconciliationRunJobProcessor } from "@/infrastructure/reconciliation/reconciliation-job-processor";
import type {
  RunScheduledReconciliationSweepUseCase,
  ScheduledSweepResult,
} from "@/application/use-cases/reconciliation/run-scheduled-reconciliation-sweep.use-case";
import type { ReconciliationRunSummary } from "@/application/use-cases/reconciliation/start-reconciliation-run.use-case";
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

function baseSweepResult(overrides: Partial<ScheduledSweepResult> = {}): ScheduledSweepResult {
  return {
    outcome: "completed",
    cursorKey: "scheduled-job-ledger",
    run: { run: baseRun(), discrepanciesCreated: 0, discrepanciesReconfirmed: 0 } satisfies ReconciliationRunSummary,
    recordsSelected: 10,
    cursorBefore: { createdAt: null, jobId: null },
    cursorAfter: { createdAt: new Date("2026-08-31T00:00:05Z"), jobId: "job-10" },
    cycleNumber: 1,
    cycleCompleted: false,
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
  it("resolves without throwing when the sweep completes (with or without discrepancies)", async () => {
    const execute = vi.fn(async (): Promise<ScheduledSweepResult> => baseSweepResult());
    const sweepUseCase = { execute } as unknown as RunScheduledReconciliationSweepUseCase;
    const processor = createReconciliationRunJobProcessor(sweepUseCase);

    await expect(processor(makeJob())).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledWith({ scope: "FULL", batchSize: 500 });
  });

  it("resolves without throwing when the sweep is skipped (locked by a concurrent invocation)", async () => {
    const execute = vi.fn(
      async (): Promise<ScheduledSweepResult> =>
        baseSweepResult({ outcome: "skipped_locked", run: null, recordsSelected: 0 }),
    );
    const sweepUseCase = { execute } as unknown as RunScheduledReconciliationSweepUseCase;
    const processor = createReconciliationRunJobProcessor(sweepUseCase);

    await expect(processor(makeJob())).resolves.toBeUndefined();
  });

  it("resolves without throwing when the sweep is skipped (empty ledger / cycle boundary)", async () => {
    const execute = vi.fn(
      async (): Promise<ScheduledSweepResult> =>
        baseSweepResult({ outcome: "skipped_empty", run: null, recordsSelected: 0, cycleCompleted: true }),
    );
    const sweepUseCase = { execute } as unknown as RunScheduledReconciliationSweepUseCase;
    const processor = createReconciliationRunJobProcessor(sweepUseCase);

    await expect(processor(makeJob())).resolves.toBeUndefined();
  });

  it("throws when the batch's reconciliation run itself FAILED, so the job layer retries/dead-letters it", async () => {
    const execute = vi.fn(
      async (): Promise<ScheduledSweepResult> =>
        baseSweepResult({
          outcome: "run_failed",
          run: {
            run: baseRun({ status: "FAILED", errorMessage: "data source unavailable", completedAt: new Date() }),
            discrepanciesCreated: 0,
            discrepanciesReconfirmed: 0,
          },
        }),
    );
    const sweepUseCase = { execute } as unknown as RunScheduledReconciliationSweepUseCase;
    const processor = createReconciliationRunJobProcessor(sweepUseCase);

    await expect(processor(makeJob())).rejects.toThrow(/data source unavailable/);
  });

  it("calls the sweep use case exactly once per attempt — this processor is not a second reconciliation engine", async () => {
    const execute = vi.fn(
      async (): Promise<ScheduledSweepResult> =>
        baseSweepResult({
          outcome: "run_failed",
          run: { run: baseRun({ status: "FAILED", errorMessage: "boom" }), discrepanciesCreated: 0, discrepanciesReconfirmed: 0 },
        }),
    );
    const sweepUseCase = { execute } as unknown as RunScheduledReconciliationSweepUseCase;
    const processor = createReconciliationRunJobProcessor(sweepUseCase);

    await expect(processor(makeJob())).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
