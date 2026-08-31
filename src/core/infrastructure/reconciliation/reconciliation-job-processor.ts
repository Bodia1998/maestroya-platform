import type { StartReconciliationRunUseCase } from "@/application/use-cases/reconciliation/start-reconciliation-run.use-case";
import type { JobProcessor } from "@/infrastructure/jobs/worker";
import type { ReconciliationRunJobData } from "@/infrastructure/reconciliation/reconciliation-jobs";

/**
 * Module 90 — Automated Reconciliation & Financial Alerting.
 *
 * The `JobProcessor` the scheduled reconciliation `Worker` runs. Thin by
 * design: it only decides what counts as "this attempt failed" for the
 * job layer's own retry/backoff/dead-letter machinery — every actual
 * reconciliation concern (idempotency, discrepancy persistence, event
 * publishing) already lives in `StartReconciliationRunUseCase` and is
 * untouched here.
 *
 * ## Why this throws when the run itself failed
 * `StartReconciliationRunUseCase.execute()` never rethrows — an engine
 * failure (e.g. the data source throwing mid-scan) is caught internally,
 * recorded as a `FAILED` `ReconciliationRun` row, and returned normally
 * (see that method's own `catch` block). That is correct for the
 * *use case's* own contract: a caller should always get a summary back,
 * never an unhandled rejection, and the persisted run record is what
 * makes "reconciliation itself failed" durably visible regardless of
 * whether anything currently reads this processor's return value at all.
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
 * already did — `run.status` is already `FAILED` and persisted; this
 * only tells the job layer to treat the *attempt* as failed too.
 */
export function createReconciliationRunJobProcessor(
  startReconciliationRun: StartReconciliationRunUseCase,
): JobProcessor<ReconciliationRunJobData> {
  return async (job) => {
    const { scope, limit } = job.data;

    const summary = await startReconciliationRun.execute({ scope, limit }, null);

    if (summary.run.status === "FAILED") {
      throw new Error(
        `Scheduled reconciliation run ${summary.run.id} failed: ${summary.run.errorMessage ?? "unknown error"}`,
      );
    }
  };
}
