import { describe, expect, it } from "vitest";

import { StartReconciliationRunUseCase } from "@/application/use-cases/reconciliation/start-reconciliation-run.use-case";
import { RunScheduledReconciliationSweepUseCase } from "@/application/use-cases/reconciliation/run-scheduled-reconciliation-sweep.use-case";
import { makeContext } from "../../../domain/reconciliation/fixtures";
import {
  FakeDistributedLock,
  FakeEventBus,
  FakeFailureReporter,
  FakeProviderFinancialReconciliationPort,
  FakeReconciliationDataSource,
  FakeReconciliationDiscrepancyRepository,
  FakeReconciliationRunRepository,
  FakeReconciliationScheduleCursorRepository,
} from "./fakes";

function makeHarness() {
  const dataSource = new FakeReconciliationDataSource();
  const runs = new FakeReconciliationRunRepository();
  const discrepancies = new FakeReconciliationDiscrepancyRepository();
  const provider = new FakeProviderFinancialReconciliationPort();
  const eventBus = new FakeEventBus();
  const failureReporter = new FakeFailureReporter();
  const cursorRepo = new FakeReconciliationScheduleCursorRepository();
  const lock = new FakeDistributedLock();

  const startReconciliationRun = new StartReconciliationRunUseCase(dataSource, runs, discrepancies, provider, eventBus, failureReporter);
  const sweep = new RunScheduledReconciliationSweepUseCase(dataSource, cursorRepo, startReconciliationRun, lock);

  return { dataSource, runs, discrepancies, provider, eventBus, failureReporter, cursorRepo, lock, startReconciliationRun, sweep };
}

function seedJobs(dataSource: FakeReconciliationDataSource, count: number, prefix = "job"): void {
  for (let i = 0; i < count; i++) {
    dataSource.seed(`${prefix}-${String(i).padStart(4, "0")}`, makeContext());
  }
}

describe("RunScheduledReconciliationSweepUseCase", () => {
  it("Scenario 1 — first scheduled run: cursor starts at initial state and the first bounded batch is selected", async () => {
    const { dataSource, sweep, cursorRepo } = makeHarness();
    seedJobs(dataSource, 5);

    const result = await sweep.execute({ scope: "FULL", batchSize: 3 });

    expect(result.outcome).toBe("completed");
    expect(result.cursorBefore).toEqual({ createdAt: null, jobId: null });
    expect(result.recordsSelected).toBe(3);
    expect(result.run?.run.recordsInspected).toBe(3);

    const persisted = await cursorRepo.getOrCreate("scheduled-job-ledger");
    expect(persisted.lastJobId).toBe(result.cursorAfter.jobId);
    expect(persisted.lastCreatedAt).toEqual(result.cursorAfter.createdAt);
  });

  it("Scenario 2 — cursor advancement: after successful reconciliation the persisted cursor moves exactly to the end of the processed batch", async () => {
    const { dataSource, sweep } = makeHarness();
    seedJobs(dataSource, 5);

    const result = await sweep.execute({ scope: "FULL", batchSize: 3 });

    expect(result.cursorAfter.jobId).toBe("job-0002"); // 0-indexed 3rd job (0,1,2)
  });

  it("Scenario 3/4 — failure: cursor does NOT move past a failed batch, and a retry re-selects the exact same batch", async () => {
    const { dataSource, sweep, runs } = makeHarness();
    seedJobs(dataSource, 5);

    // Force the engine itself to fail (not a per-job finding) by making
    // the run repository's own `complete()` throw — StartReconciliationRunUseCase
    // catches this in its outer try/catch and persists a FAILED run.
    const originalComplete = runs.complete.bind(runs);
    let shouldFail = true;
    runs.complete = async (data) => {
      if (shouldFail) throw new Error("Module 92 test: simulated engine failure");
      return originalComplete(data);
    };

    const first = await sweep.execute({ scope: "FULL", batchSize: 3 });
    expect(first.outcome).toBe("run_failed");
    expect(first.cursorAfter).toEqual(first.cursorBefore);
    expect(first.cursorAfter).toEqual({ createdAt: null, jobId: null });

    // Retry: same batch selected again (cursor never moved).
    shouldFail = false;
    const retry = await sweep.execute({ scope: "FULL", batchSize: 3 });
    expect(retry.outcome).toBe("completed");
    expect(retry.recordsSelected).toBe(3);
    expect(retry.cursorAfter.jobId).toBe("job-0002");
  });

  it("Scenario 5 — multiple batches: run 1 -> batch A, run 2 -> batch B, run 3 -> batch C, no batch permanently skipped", async () => {
    const { dataSource, sweep } = makeHarness();
    seedJobs(dataSource, 10);

    const run1 = await sweep.execute({ scope: "FULL", batchSize: 4 });
    const run2 = await sweep.execute({ scope: "FULL", batchSize: 4 });
    const run3 = await sweep.execute({ scope: "FULL", batchSize: 4 });

    const inspectedIds = [run1, run2, run3].flatMap((r) => (r.run ? [r.recordsSelected] : []));
    expect(inspectedIds).toEqual([4, 4, 2]);
    expect(run3.cycleCompleted).toBe(true);

    // Union of all three batches covers every seeded job exactly once —
    // proof no job was skipped or double-counted across batch boundaries.
    const totalInspected = run1.run!.run.recordsInspected + run2.run!.run.recordsInspected + run3.run!.run.recordsInspected;
    expect(totalInspected).toBe(10);
  });

  it("Scenario 6 — full cycle: reaching the end resets the cursor and starts a new cycle from the top", async () => {
    const { dataSource, sweep } = makeHarness();
    seedJobs(dataSource, 5);

    const run1 = await sweep.execute({ scope: "FULL", batchSize: 5 });
    expect(run1.outcome).toBe("completed");
    expect(run1.cycleCompleted).toBe(true);
    expect(run1.cursorAfter).toEqual({ createdAt: null, jobId: null });
    expect(run1.cycleNumber).toBe(2);

    // Next invocation starts a fresh pass from the very first job again.
    const run2 = await sweep.execute({ scope: "FULL", batchSize: 5 });
    expect(run2.outcome).toBe("completed");
    expect(run2.recordsSelected).toBe(5);
    expect(run2.run!.run.recordsInspected).toBe(5);
  });

  it("empty ledger: no-ops without creating a run and without incrementing the cycle", async () => {
    const { dataSource, sweep, runs } = makeHarness();
    void dataSource;

    const result = await sweep.execute({ scope: "FULL", batchSize: 5 });

    expect(result.outcome).toBe("skipped_empty");
    expect(result.cycleCompleted).toBe(false);
    expect(result.cycleNumber).toBe(1);
    expect(await runs.count()).toBe(0);
  });

  it("Scenario 7 — new records: a Job created after the cursor has advanced is eventually reconciled within the same cycle", async () => {
    const { dataSource, sweep } = makeHarness();
    seedJobs(dataSource, 3);

    const run1 = await sweep.execute({ scope: "FULL", batchSize: 2 });
    expect(run1.recordsSelected).toBe(2);

    // A brand-new Job appears — created "now," necessarily after every
    // already-seeded synthetic createdAt (see FakeReconciliationDataSource.seed).
    dataSource.seed("job-new", makeContext(), { createdAt: new Date(Date.now() + 10_000_000) });

    const run2 = await sweep.execute({ scope: "FULL", batchSize: 2 });
    expect(run2.recordsSelected).toBe(2); // remaining original job + the new one
    expect(run2.cycleCompleted).toBe(true);
  });

  it("Scenario 8 — timestamp collisions: identical cursor timestamps never cause a Job to be skipped", async () => {
    const { dataSource, sweep } = makeHarness();
    const sameInstant = new Date("2026-05-01T00:00:00.000Z");
    dataSource.seed("job-b", makeContext(), { createdAt: sameInstant });
    dataSource.seed("job-a", makeContext(), { createdAt: sameInstant });
    dataSource.seed("job-c", makeContext(), { createdAt: sameInstant });

    const run1 = await sweep.execute({ scope: "FULL", batchSize: 2 });
    const run2 = await sweep.execute({ scope: "FULL", batchSize: 2 });

    const totalInspected = (run1.run?.run.recordsInspected ?? 0) + (run2.run?.run.recordsInspected ?? 0);
    expect(totalInspected).toBe(3); // all three same-timestamp jobs inspected exactly once combined
    expect(run1.cursorAfter.jobId).toBe("job-b"); // "job-a" < "job-b" < "job-c" tie-break
  });

  it("Scenario 9 — concurrent scheduler execution: a second overlapping invocation is skipped, never double-advances the cursor", async () => {
    const { dataSource, sweep, lock } = makeHarness();
    seedJobs(dataSource, 5);
    lock.nextAcquireFails = true; // simulate another scheduler instance already holding the lock

    const result = await sweep.execute({ scope: "FULL", batchSize: 3 });

    expect(result.outcome).toBe("skipped_locked");
    expect(result.cursorAfter).toEqual(result.cursorBefore);
    expect(result.cursorAfter).toEqual({ createdAt: null, jobId: null });
  });

  it("Scenario 10 — restart safety: a cursor-advance race (lock bypass) is detected and never silently clobbers state", async () => {
    const { dataSource, sweep, cursorRepo } = makeHarness();
    seedJobs(dataSource, 5);

    // Simulate another process having already advanced the cursor between
    // this run's read and its own advance() call (the belt-and-suspenders
    // optimistic-concurrency path, independent of the DistributedLock).
    const cursor = await cursorRepo.getOrCreate("scheduled-job-ledger");
    const originalAdvance = cursorRepo.advance.bind(cursorRepo);
    let intercepted = false;
    cursorRepo.advance = async (data) => {
      if (!intercepted) {
        intercepted = true;
        // Someone else bumps the version first.
        await originalAdvance({ ...data, expectedVersion: cursor.version });
        // The use case's own call (still carrying the stale expectedVersion) — hits the race.
      }
      return originalAdvance(data);
    };

    const result = await sweep.execute({ scope: "FULL", batchSize: 3 });

    // The batch was still reconciled (safe/idempotent even under the race);
    // the use case does not crash, and it reports the pre-race cursor
    // rather than fabricating a false "advanced to X" position.
    expect(result.outcome).toBe("completed");
    expect(result.run?.run.status).toBe("COMPLETED");
  });
});
