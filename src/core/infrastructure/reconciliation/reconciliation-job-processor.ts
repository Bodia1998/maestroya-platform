import type { RunScheduledReconciliationSweepUseCase } from "@/application/use-cases/reconciliation/run-scheduled-reconciliation-sweep.use-case";
import type { JobProcessor } from "@/infrastructure/jobs/worker";
import type { ReconciliationRunJobData } from "@/infrastructure/reconciliation/reconciliation-jobs";

/**
 * Module 90 — Automated Reconciliation & Financial Alerting.
 * Module 92 — Reconciliation Full-Ledger Coverage & Advancing Cursor.
 *
 * The `JobProcessor` the scheduled reconciliation `Worker` runs. Thin by
 * design: it only decides what counts as "this attempt failed" for the
 * job layer's own retry/backoff/dead-letter machinery — every actual
 * reconciliation and cursor-advancement concern (idempotency, batch
 * selection, checkpoint persistence, discrepancy persistence, event
 * publishing) already lives in `RunScheduledReconciliationSweepUseCase`
 * (which itself delegates the actual scan/detect/persist work to the one
 * `StartReconciliationRunUseCase` engine) and is untouched here.
 *
 * As of Module 92 this calls `RunScheduledReconciliationSweepUseCase`,
 * not `StartReconciliationRunUseCase` directly — the sweep use case is
 * what turns a bounded `limit`-sized scan into durable, cursor-advancing
 * full-ledger coverage; see that class's own doc comment. `job.data.limit`
 * is now this invocation's *batch size*, not "how many of the most-recent
 * Jobs to rescan" — same config value (`RECONCILIATION_SCHEDULE_LIMIT`),
 * new, documented meaning.
 *
 * ## Why this throws when the run itself failed
 * `StartReconciliationRunUseCase.execute()` never rethrows — an engine
 * failure (e.g. the data source throwing mid-scan) is caught internally,
 * recorded as a `FAILED` `ReconciliationRun` row, and returned normally
 * (see that method's own `catch` block). `RunScheduledReconciliationSweepUseCase`
 * preserves that contract (it also never throws for a failed batch — it
 * returns `outcome: "run_failed"` and deliberately leaves the cursor
 * unmoved so the same batch is retried next time). That is correct for
 * both use cases' own contracts: a caller should always get a summary
 * back, never an unhandled rejection.
 *
 * But scheduled automation (spec Step 4, "worker retry") additionally
 * needs the *job* layer to know an attempt failed, so `Worker`'s own
 * attempts/backoff and dead-letter queue apply — a transient failure
 * (a brief DB blip mid-scan) gets retried automatically instead of
 * silently waiting for the next scheduled occurrence, and a persistently
 * failing engine eventually lands in the dead-letter queue where it is
 * operationally visible (`getBackgroundJobsHealth()` / Module 45's own
 * dead-letter reporting) rather than failing forever, invisibly, once a
 * day. Throwing here does not change or re-run anything the use case
 * already did — the run's own status (and the cursor's own position) are
 * already persisted; this only tells the job layer to treat the
 * *attempt* as failed too.
 *
 * `outcome: "skipped_locked"`/`"skipped_empty"` are NOT failures — a
 * concurrent overlap or a genuinely empty/fully-cycled ledger is expected
 * behavior (see `RunScheduledReconciliationSweepUseCase`'s own doc
 * comment), so this processor returns normally for both, same as a
 * successful `"completed"` outcome.
 */
export function createReconciliationRunJobProcessor(
  runScheduledReconciliationSweep: RunScheduledReconciliationSweepUseCase,
): JobProcessor<ReconciliationRunJobData> {
  return async (job) => {
    const { scope, limit } = job.data;

    const result = await runScheduledReconciliationSweep.execute({ scope, batchSize: limit });

    if (result.outcome === "run_failed" && result.run) {
      throw new Error(
        `Scheduled reconciliation sweep batch (run ${result.run.run.id}) failed: ${result.run.run.errorMessage ?? "unknown error"}`,
      );
    }
  };
}
