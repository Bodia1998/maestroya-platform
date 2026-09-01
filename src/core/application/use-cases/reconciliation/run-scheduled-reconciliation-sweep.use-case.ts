import type { DistributedLock } from "@/application/ports/distributed-lock";
import type { ReconciliationDataSource } from "@/application/ports/reconciliation-data-source";
import type { ReconciliationScheduleCursorRepository } from "@/domain/repositories/reconciliation-schedule-cursor-repository";
import type { ReconciliationScopeValue } from "@/domain/repositories/reconciliation-repository";
import {
  recordScheduledSweepAdvanced,
  recordScheduledSweepBatchFailed,
  recordScheduledSweepCursorRace,
  recordScheduledSweepSkippedEmpty,
  recordScheduledSweepSkippedLocked,
} from "@/infrastructure/observability/reconciliation-observability";
import type { ReconciliationRunSummary, StartReconciliationRunUseCase } from "./start-reconciliation-run.use-case";

/**
 * Module 92 — Reconciliation Full-Ledger Coverage & Advancing Cursor.
 *
 * The scheduling/checkpoint orchestrator that gives the automated
 * reconciliation trigger (the Vercel Cron route and the in-process
 * `JobScheduler` occurrence — both call this use case now, not
 * `StartReconciliationRunUseCase` directly) durable, advancing coverage
 * of the *entire* eligible Job ledger, replacing the previous behavior of
 * always rescanning only the most-recently-active `limit` Jobs (see
 * `PrismaReconciliationDataSource.listJobIdsToInspectFromCursor`'s own
 * doc comment for the full "why this was broken" background).
 *
 * This class owns no reconciliation logic of its own — it is entirely
 * about *which bounded batch of Job ids* the one, unchanged
 * `StartReconciliationRunUseCase` engine reconciles on each scheduled
 * invocation, and *when it is safe to move the durable cursor forward*.
 * There is still only one reconciliation engine, one discrepancy
 * detection/persistence path, one dedup mechanism — see that class's own
 * doc comment, untouched by this module except for the additive `jobIds`
 * escape hatch this use case is the sole caller of.
 *
 * ## The five-step sequence (failure-safety)
 * Every invocation, once the lock is held, follows exactly this order:
 *
 *   1. **Read** the current cursor (`cursorRepo.getOrCreate`).
 *   2. **Select** a bounded batch strictly after that cursor
 *      (`dataSource.listJobIdsToInspectFromCursor`) — never more than
 *      `batchSize` Jobs, never a second query in the same invocation.
 *   3. **Reconcile** the batch (`startReconciliationRun.execute` with
 *      `jobIds` set to exactly this batch).
 *   4. **Only if** that run's own status is not `FAILED`, **persist** the
 *      new cursor position (`cursorRepo.advance`), pointing at the last
 *      Job actually included in the batch just reconciled.
 *   5. If the run **failed** — an unexpected exception inside the engine
 *      itself, e.g. the data source throwing mid-scan (see
 *      `StartReconciliationRunUseCase.execute`'s own doc comment on what
 *      it does and does not catch) — the cursor is left exactly where it
 *      was. The next scheduled invocation reads the same, unmoved cursor
 *      and selects the exact same batch again: a failed batch is always
 *      retried, never skipped, never partially advanced past.
 *
 * This is safe even though `StartReconciliationRunUseCase` processes Jobs
 * one at a time internally and could in principle fail partway through a
 * batch: the cursor is a batch-level checkpoint, not a per-Job one — a
 * run that fails after successfully reconciling Job 3 of 5 in its batch
 * still reports `status: "FAILED"` for the *run as a whole* (see that use
 * case's own `catch` block), so this use case does not advance the
 * cursor at all, and the retry re-reconciles all 5 Jobs. Re-reconciling
 * an already-reconciled Job is always safe and produces no duplicate
 * effect: this module writes nothing financial, and every discrepancy it
 * would (re-)detect is deduplicated by
 * `ReconciliationDiscrepancyRepository.createOrTouch`'s fingerprint +
 * database partial-unique index (Module 80/91's own invariant, unchanged
 * by this module) — a retried batch re-confirms existing open
 * discrepancies rather than duplicating them.
 *
 * ## Concurrency
 * The entire five-step sequence runs inside `lock.withLock(...)` (the
 * existing `DistributedLock` — Module 44 — the same primitive
 * `ExecuteProfessionalPayoutUseCase` already uses for a different
 * resource; no second locking mechanism is introduced). A second
 * concurrent invocation that cannot acquire the lock does not block or
 * retry — it returns immediately with `outcome: "skipped_locked"`
 * (logged at `info`, not an error: this is the JobScheduler-occurrence
 * and Vercel-Cron-invocation paths' own overlap being handled exactly as
 * designed, see `reconciliation-run/route.ts`'s own doc comment on why
 * an overlapping invocation is an expected, harmless possibility, not a
 * bug). The lock TTL is chosen comfortably longer than a single bounded
 * batch is expected to take, so a holder that crashes mid-batch still
 * self-releases the lock rather than blocking every future scheduled
 * invocation forever.
 *
 * Belt-and-suspenders beneath the lock: `cursorRepo.advance` is itself an
 * optimistic-concurrency conditional update (see that port's own doc
 * comment) — even in a hypothetical misconfiguration where two processes
 * somehow used two different, non-coordinating lock backends, at most one
 * of them could ever successfully advance the cursor for a given prior
 * state; the loser's `advance` call returns `null` and this use case logs
 * it (`recordScheduledSweepCursorRace`) rather than silently clobbering
 * the winner's advancement or throwing.
 *
 * ## Full-cycle wraparound
 * When a batch's `cycleCompleted` flag is true (the query found no more
 * eligible Jobs after it — see `ReconciliationJobCursorBatch`'s own doc
 * comment) and the run succeeds, the cursor is reset to `null`/`null`
 * (start of a new cycle) and `cycleNumber` is incremented, rather than
 * being left pointing "past the end." The very next scheduled invocation
 * then starts a fresh pass from the very first eligible Job again — the
 * ledger is continuously, repeatedly swept end-to-end, not scanned once
 * and then left idle. When a batch is legitimately empty (nothing at all
 * after the cursor — either the whole cycle is done, or there are simply
 * no eligible Jobs yet), no `ReconciliationRun` row is created for it
 * (there is nothing to reconcile) — this use case still resets the
 * cursor for a genuine cycle completion, and no-ops (without touching the
 * cursor, without bumping `cycleNumber`) when the ledger is and remains
 * empty.
 *
 * ## New/updated records
 * `createdAt` is immutable and monotonically non-decreasing (see
 * `listJobIdsToInspectFromCursor`'s own doc comment), so any Job created
 * *after* the sweep's current cursor position is necessarily ordered
 * *after* it — it is swept later in the very same cycle, not stranded
 * until the next wraparound. A Job whose *related* financial rows change
 * after this sweep has already passed it (a refund posted against an old
 * Job, say) is picked up again at the next full cycle, since every cycle
 * re-inspects every eligible Job regardless of whether anything about it
 * changed — see MODULE_92_IMPLEMENTATION_REPORT.md, "Known limitations,"
 * for the latency this implies and the existing (unmodified) manual
 * `since`-scoped admin run as the complementary fast-path for an operator
 * who needs sooner coverage of a specific recent change.
 */
export interface ScheduledSweepParams {
  scope: ReconciliationScopeValue;
  /** Maximum Jobs inspected in this one invocation — `RECONCILIATION_SCHEDULE_LIMIT`. */
  batchSize: number;
}

export type ScheduledSweepOutcome = "completed" | "run_failed" | "skipped_locked" | "skipped_empty";

export interface ScheduledSweepResult {
  outcome: ScheduledSweepOutcome;
  cursorKey: string;
  run: ReconciliationRunSummary | null;
  recordsSelected: number;
  cursorBefore: { createdAt: Date | null; jobId: string | null };
  cursorAfter: { createdAt: Date | null; jobId: string | null };
  cycleNumber: number;
  cycleCompleted: boolean;
}

/** The one cursor this module maintains today — see this class's own doc
 *  comment and the `ReconciliationScheduleCursor` Prisma model's doc
 *  comment on why the column supports more than one key even though only
 *  one is used. Job-ledger coverage does not depend on `scope` (which
 *  checks run against each Job), so a scope change does not need — and
 *  deliberately does not get — its own cursor. */
const CURSOR_KEY = "scheduled-job-ledger";

/** Comfortably longer than a `RECONCILIATION_SCHEDULE_LIMIT`-sized batch
 *  (bounded at 2000 Jobs) is expected to take, mirroring
 *  `ExecuteProfessionalPayoutUseCase`'s own `LOCK_TTL_MS` reasoning: a
 *  safety net for a crashed holder, not a scheduling mechanism. */
const LOCK_TTL_MS = 5 * 60 * 1000;

export class RunScheduledReconciliationSweepUseCase {
  constructor(
    private readonly dataSource: ReconciliationDataSource,
    private readonly cursorRepo: ReconciliationScheduleCursorRepository,
    private readonly startReconciliationRun: StartReconciliationRunUseCase,
    private readonly lock: DistributedLock,
  ) {}

  async execute(params: ScheduledSweepParams): Promise<ScheduledSweepResult> {
    const lockKey = `reconciliation:schedule-cursor:${CURSOR_KEY}`;

    const result = await this.lock.withLock(lockKey, LOCK_TTL_MS, () => this.runLocked(params));

    if (result === null) {
      recordScheduledSweepSkippedLocked({ cursorKey: CURSOR_KEY });
      const cursor = await this.cursorRepo.getOrCreate(CURSOR_KEY);
      return {
        outcome: "skipped_locked",
        cursorKey: CURSOR_KEY,
        run: null,
        recordsSelected: 0,
        cursorBefore: { createdAt: cursor.lastCreatedAt, jobId: cursor.lastJobId },
        cursorAfter: { createdAt: cursor.lastCreatedAt, jobId: cursor.lastJobId },
        cycleNumber: cursor.cycleNumber,
        cycleCompleted: false,
      };
    }

    return result;
  }

  private async runLocked(params: ScheduledSweepParams): Promise<ScheduledSweepResult> {
    const startedAt = Date.now();
    const cursor = await this.cursorRepo.getOrCreate(CURSOR_KEY);
    const cursorBefore = { createdAt: cursor.lastCreatedAt, jobId: cursor.lastJobId };

    const after = cursor.lastCreatedAt && cursor.lastJobId ? { createdAt: cursor.lastCreatedAt, id: cursor.lastJobId } : null;

    const batch = await this.dataSource.listJobIdsToInspectFromCursor({ after, limit: params.batchSize });

    if (batch.jobIds.length === 0) {
      // Nothing to reconcile this invocation: either the whole cycle is
      // done (we had a non-null cursor, i.e. we'd made real progress this
      // cycle) or the ledger is currently empty (cursor was already at
      // the start). Only the former is a genuine cycle boundary.
      const cycleCompleted = cursor.lastJobId !== null;
      let cycleNumber = cursor.cycleNumber;

      if (cycleCompleted) {
        const now = new Date();
        const advanced = await this.cursorRepo.advance({
          cursorKey: CURSOR_KEY,
          expectedVersion: cursor.version,
          lastCreatedAt: null,
          lastJobId: null,
          cycleNumber: cursor.cycleNumber + 1,
          cycleStartedAt: now,
        });
        if (advanced) {
          cycleNumber = advanced.cycleNumber;
        } else {
          recordScheduledSweepCursorRace({ cursorKey: CURSOR_KEY, runId: "n/a" });
        }
      }

      recordScheduledSweepSkippedEmpty({ cursorKey: CURSOR_KEY, cycleNumber, cycleCompleted });

      return {
        outcome: "skipped_empty",
        cursorKey: CURSOR_KEY,
        run: null,
        recordsSelected: 0,
        cursorBefore,
        cursorAfter: { createdAt: null, jobId: null },
        cycleNumber,
        cycleCompleted,
      };
    }

    const summary = await this.startReconciliationRun.execute(
      { scope: params.scope, limit: params.batchSize, jobIds: batch.jobIds },
      null,
    );

    if (summary.run.status === "FAILED") {
      recordScheduledSweepBatchFailed({
        cursorKey: CURSOR_KEY,
        runId: summary.run.id,
        cursorBefore: { createdAt: cursorBefore.createdAt?.toISOString() ?? null, jobId: cursorBefore.jobId },
        recordsSelected: batch.jobIds.length,
        errorMessage: summary.run.errorMessage,
      });

      return {
        outcome: "run_failed",
        cursorKey: CURSOR_KEY,
        run: summary,
        recordsSelected: batch.jobIds.length,
        cursorBefore,
        cursorAfter: cursorBefore,
        cycleNumber: cursor.cycleNumber,
        cycleCompleted: false,
      };
    }

    const now = new Date();
    // Cycle-complete resets to the start of a fresh cycle even though
    // this batch itself is non-empty (batch.cycleCompleted means "no
    // more eligible Jobs exist after this batch," not "this batch was
    // empty") — see ReconciliationJobCursorBatch's own doc comment.
    const nextCursorPosition: { createdAt: Date | null; id: string | null } = batch.cycleCompleted
      ? { createdAt: null, id: null }
      : { createdAt: batch.nextCursor?.createdAt ?? null, id: batch.nextCursor?.id ?? null };
    const nextCycleNumber = batch.cycleCompleted ? cursor.cycleNumber + 1 : cursor.cycleNumber;
    const nextCycleStartedAt = batch.cycleCompleted ? now : cursor.cycleStartedAt;

    const advanced = await this.cursorRepo.advance({
      cursorKey: CURSOR_KEY,
      expectedVersion: cursor.version,
      lastCreatedAt: nextCursorPosition.createdAt,
      lastJobId: nextCursorPosition.id,
      cycleNumber: nextCycleNumber,
      cycleStartedAt: nextCycleStartedAt,
    });

    let cursorAfter: { createdAt: Date | null; jobId: string | null };
    let cycleNumber: number;
    if (advanced) {
      cursorAfter = { createdAt: advanced.lastCreatedAt, jobId: advanced.lastJobId };
      cycleNumber = advanced.cycleNumber;
    } else {
      // Belt-and-suspenders race (see this class's own doc comment) — the
      // batch was already successfully reconciled above (idempotent, no
      // financial write, dedup'd discrepancies), so nothing here is
      // unsafe to leave as-is; another concurrent advance already moved
      // the cursor forward, which is what matters for coverage.
      recordScheduledSweepCursorRace({ cursorKey: CURSOR_KEY, runId: summary.run.id });
      cursorAfter = cursorBefore;
      cycleNumber = cursor.cycleNumber;
    }

    recordScheduledSweepAdvanced({
      cursorKey: CURSOR_KEY,
      runId: summary.run.id,
      cursorBefore: { createdAt: cursorBefore.createdAt?.toISOString() ?? null, jobId: cursorBefore.jobId },
      cursorAfter: { createdAt: cursorAfter.createdAt?.toISOString() ?? null, jobId: cursorAfter.jobId },
      recordsSelected: batch.jobIds.length,
      cycleNumber,
      cycleCompleted: batch.cycleCompleted,
      durationMs: Date.now() - startedAt,
    });

    return {
      outcome: "completed",
      cursorKey: CURSOR_KEY,
      run: summary,
      recordsSelected: batch.jobIds.length,
      cursorBefore,
      cursorAfter,
      cycleNumber,
      cycleCompleted: batch.cycleCompleted,
    };
  }
}
